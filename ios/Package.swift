// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MLMVPNSovereignCore",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "SovereignShared", targets: ["SovereignShared"]),
    ],
    targets: [
        .target(
            name: "SovereignShared",
            path: "Shared"
        ),
    ]
)
