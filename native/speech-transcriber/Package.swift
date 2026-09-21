// swift-tools-version: 6.0
import PackageDescription

// Deployment target stays below the macOS 26 Speech APIs this tool uses, so the
// binary launches on every macOS the desktop app supports and reports
// `unavailable` there instead of failing to execute.
let package = Package(
    name: "t3-speech-transcriber",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "t3-speech-transcriber", path: "Sources/t3-speech-transcriber")
    ]
)
