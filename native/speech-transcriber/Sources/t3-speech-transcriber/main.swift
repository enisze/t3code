import AVFoundation
import Foundation
#if canImport(Speech)
    import Speech
#endif

/// Exit codes the desktop app distinguishes. Anything else is a crash.
private enum ExitCode: Int32 {
    case ok = 0
    case failed = 1
    case usage = 2
}

/// Mirrors `VoiceTranscriptionErrorCode` in `@t3tools/client-runtime/voice-input`,
/// so the renderer can map a failure straight onto the shared error type.
private enum FailureCode: String {
    case unavailable
    case unsupportedLocale = "unsupported-locale"
    case preparationFailed = "preparation-failed"
    case transcriptionFailed = "transcription-failed"
}

private struct Failure: Error {
    let code: FailureCode
    let message: String
}

private func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

private func fail(_ code: FailureCode, _ message: String) -> Never {
    emit(["ok": false, "code": code.rawValue, "message": message])
    exit(ExitCode.failed.rawValue)
}

/// Normalises `en_US` and `en-us` alike, since callers pass through whatever
/// `Intl` or Electron reported.
private func normalizeLocaleIdentifier(_ raw: String) -> String {
    raw.replacingOccurrences(of: "_", with: "-")
}

@available(macOS 26, *)
private func resolveLocale(_ requested: String) async throws -> Locale {
    let wanted = Locale(identifier: normalizeLocaleIdentifier(requested))
    let supported = await SpeechTranscriber.supportedLocales
    let exact = supported.first { $0.identifier(.bcp47) == wanted.identifier(.bcp47) }
    if let exact { return exact }
    // Fall back to any region of the same language before giving up, so a
    // `de-AT` user still gets `de-DE` rather than no dictation at all.
    let sameLanguage = supported.first { $0.language.languageCode == wanted.language.languageCode }
    guard let sameLanguage else {
        throw Failure(
            code: .unsupportedLocale,
            message: "Dictation does not support \(wanted.identifier(.bcp47))."
        )
    }
    return sameLanguage
}

@available(macOS 26, *)
private func installAssetsIfNeeded(_ transcriber: SpeechTranscriber, locale: Locale) async throws {
    let installed = await SpeechTranscriber.installedLocales
    if installed.contains(where: { $0.identifier(.bcp47) == locale.identifier(.bcp47) }) { return }
    do {
        // The first run for a language downloads an on-device model. There is no
        // progress channel here; the renderer shows its "preparing" phase.
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
        {
            try await request.downloadAndInstall()
        }
    } catch {
        throw Failure(
            code: .preparationFailed,
            message: "Could not install the dictation model: \(error.localizedDescription)"
        )
    }
}

@available(macOS 26, *)
private func transcribe(inputPath: String, requestedLocale: String) async throws -> (String, String) {
    let locale = try await resolveLocale(requestedLocale)
    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    try await installAssetsIfNeeded(transcriber, locale: locale)

    let url = URL(fileURLWithPath: inputPath)
    let file: AVAudioFile
    do {
        file = try AVAudioFile(forReading: url)
    } catch {
        throw Failure(
            code: .transcriptionFailed,
            message: "Could not read the recording: \(error.localizedDescription)"
        )
    }

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    // Drain results concurrently: `analyzeSequence` only returns once the file
    // has been consumed, and the results sequence finishes with the analyzer.
    let collected = Task {
        var transcript = AttributedString()
        for try await result in transcriber.results where result.isFinal {
            transcript += result.text
        }
        return String(transcript.characters)
    }

    do {
        if let lastSample = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: lastSample)
        } else {
            await analyzer.cancelAndFinishNow()
        }
    } catch {
        collected.cancel()
        throw Failure(
            code: .transcriptionFailed,
            message: "Dictation failed: \(error.localizedDescription)"
        )
    }

    do {
        let text = try await collected.value
        return (text.trimmingCharacters(in: .whitespacesAndNewlines), locale.identifier(.bcp47))
    } catch {
        throw Failure(
            code: .transcriptionFailed,
            message: "Dictation failed: \(error.localizedDescription)"
        )
    }
}

/// One NDJSON line per event on stdout, so the desktop app can forward results
/// as they arrive rather than waiting for the recording to finish.
@available(macOS 26, *)
private func runStream(requestedLocale: String) async throws {
    let locale = try await resolveLocale(requestedLocale)
    // `.progressiveTranscription` is the preset that reports volatile results;
    // `.transcription` only ever emits finals.
    let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
    try await installAssetsIfNeeded(transcriber, locale: locale)

    guard
        let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber])
    else {
        throw Failure(code: .preparationFailed, message: "No compatible audio format.")
    }
    // The analyzer traps on a buffer in any other format, so rather than assume
    // one, the caller is told the exact layout and the bytes are copied in
    // verbatim. On macOS 26 this asks for 16-bit mono, not float.
    guard analyzerFormat.channelCount == 1 else {
        throw Failure(
            code: .preparationFailed,
            message: "Dictation expected a mono analyzer format."
        )
    }
    let bytesPerFrame = Int(analyzerFormat.streamDescription.pointee.mBytesPerFrame)
    guard bytesPerFrame > 0 else {
        throw Failure(code: .preparationFailed, message: "Analyzer reported an empty frame size.")
    }
    let sampleEncoding = analyzerFormat.commonFormat == .pcmFormatInt16 ? "int16" : "float32"

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let reader = Task {
        for try await result in transcriber.results {
            emit([
                "type": result.isFinal ? "final" : "volatile",
                "text": String(result.text.characters),
            ])
        }
    }

    let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
    try await analyzer.start(inputSequence: stream)
    emit([
        "type": "ready",
        "locale": locale.identifier(.bcp47),
        "sampleRate": analyzerFormat.sampleRate,
        "encoding": sampleEncoding,
    ])

    // Read raw mono frames until the app closes stdin, which is how it signals
    // the end of the recording.
    let input = FileHandle.standardInput
    var pending = Data()
    var yieldedAudio = false
    while true {
        let chunk = input.availableData
        if chunk.isEmpty { break }
        pending.append(chunk)
        let frames = pending.count / bytesPerFrame
        if frames == 0 { continue }

        let usable = frames * bytesPerFrame
        guard
            let buffer = AVAudioPCMBuffer(
                pcmFormat: analyzerFormat, frameCapacity: AVAudioFrameCount(frames))
        else { break }
        buffer.frameLength = AVAudioFrameCount(frames)
        if let destination = buffer.mutableAudioBufferList.pointee.mBuffers.mData {
            pending.prefix(usable).withUnsafeBytes { raw in
                guard let base = raw.baseAddress else { return }
                memcpy(destination, base, usable)
            }
        }
        pending.removeFirst(usable)
        yieldedAudio = true
        continuation.yield(AnalyzerInput(buffer: buffer))
    }

    continuation.finish()
    // A stream that never received a frame - a tap-and-stop with no speech -
    // neither finalises nor ends its results sequence, so it is torn down
    // rather than awaited.
    if yieldedAudio {
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        try await reader.value
    } else {
        await analyzer.cancelAndFinishNow()
        reader.cancel()
    }
    emit(["type": "done"])
}

private func value(of flag: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
        return nil
    }
    return arguments[index + 1]
}

@main
struct SpeechTranscriberTool {
    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard let command = arguments.first else {
            emit(["ok": false, "code": "usage", "message": "Expected `probe`, `stream`, or `transcribe`."])
            exit(ExitCode.usage.rawValue)
        }
        let requestedLocale = value(of: "--locale", in: arguments) ?? "en-US"

        guard #available(macOS 26, *) else {
            fail(.unavailable, "Dictation requires macOS 26 or later.")
        }

        switch command {
        case "probe":
            do {
                let locale = try await resolveLocale(requestedLocale)
                emit(["ok": true, "locale": locale.identifier(.bcp47)])
            } catch let failure as Failure {
                fail(failure.code, failure.message)
            } catch {
                fail(.preparationFailed, error.localizedDescription)
            }
        case "stream":
            do {
                try await runStream(requestedLocale: requestedLocale)
            } catch let failure as Failure {
                fail(failure.code, failure.message)
            } catch {
                fail(.transcriptionFailed, error.localizedDescription)
            }
        case "transcribe":
            guard let inputPath = value(of: "--input", in: arguments) else {
                emit(["ok": false, "code": "usage", "message": "`transcribe` needs --input."])
                exit(ExitCode.usage.rawValue)
            }
            do {
                let (text, locale) = try await transcribe(
                    inputPath: inputPath, requestedLocale: requestedLocale)
                emit(["ok": true, "text": text, "locale": locale])
            } catch let failure as Failure {
                fail(failure.code, failure.message)
            } catch {
                fail(.transcriptionFailed, error.localizedDescription)
            }
        default:
            emit(["ok": false, "code": "usage", "message": "Unknown command \(command)."])
            exit(ExitCode.usage.rawValue)
        }
    }
}
