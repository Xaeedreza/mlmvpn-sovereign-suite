import SwiftUI

public enum SovereignTheme {
    // Warm Velvet Amber & Rose-Gold Palette
    public static let velvetBgTop = Color(red: 0.11, green: 0.06, blue: 0.08)
    public static let velvetBgMid = Color(red: 0.22, green: 0.09, blue: 0.13)
    public static let velvetBgBot = Color(red: 0.08, green: 0.04, blue: 0.05)

    public static let amberGlow = Color(red: 0.94, green: 0.56, blue: 0.24)
    public static let roseGold = Color(red: 0.91, green: 0.45, blue: 0.43)
    public static let champagne = Color(red: 1.00, green: 0.87, blue: 0.68)
    public static let emeraldConnected = Color(red: 0.20, green: 0.78, blue: 0.52)

    public static let glassCard = Color.white.opacity(0.08)
    public static let glassBorder = Color.white.opacity(0.16)

    public static var velvetGradient: LinearGradient {
        LinearGradient(
            colors: [velvetBgTop, velvetBgMid, velvetBgBot],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    public static var heroCardGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.54, green: 0.19, blue: 0.27),
                Color(red: 0.34, green: 0.11, blue: 0.16)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    public static var connectedGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.13, green: 0.45, blue: 0.33),
                Color(red: 0.08, green: 0.24, blue: 0.20)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

public struct VelvetGlassCard<Content: View>: View {
    let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        content
            .padding(16)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(SovereignTheme.glassBorder, lineWidth: 0.8)
            )
    }
}

public struct SovereignOrbButton: View {
    let isConnected: Bool
    let isConnecting: Bool
    let title: String
    let subtitle: String
    let action: () -> Void

    @State private var pulse = false

    public var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                (isConnected ? SovereignTheme.emeraldConnected : SovereignTheme.amberGlow).opacity(pulse ? 0.36 : 0.16),
                                .clear
                            ],
                            center: .center,
                            startRadius: 20,
                            endRadius: 96
                        )
                    )
                    .frame(width: 185, height: 185)
                    .scaleEffect(pulse ? 1.07 : 0.96)

                Circle()
                    .fill(isConnected ? SovereignTheme.connectedGradient : SovereignTheme.heroCardGradient)
                    .frame(width: 138, height: 138)
                    .overlay(
                        Circle()
                            .strokeBorder(
                                (isConnected ? SovereignTheme.emeraldConnected : SovereignTheme.champagne).opacity(0.65),
                                lineWidth: 2
                            )
                    )
                    .shadow(
                        color: (isConnected ? SovereignTheme.emeraldConnected : SovereignTheme.roseGold).opacity(0.45),
                        radius: 20,
                        x: 0,
                        y: 10
                    )

                VStack(spacing: 6) {
                    if isConnecting {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(1.2)
                    } else {
                        Image(systemName: isConnected ? "shield.checkered" : "power")
                            .font(.system(size: 32, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    Text(title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                    Text(subtitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(SovereignTheme.champagne.opacity(0.88))
                }
            }
        }
        .buttonStyle(.plain)
        .onAppear {
            withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}
