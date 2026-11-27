import CommonCrypto
import CryptoKit
import Foundation

public enum SovereignCryptoError: LocalizedError {
    case passphraseTooShort
    case invalidBundlePrefix
    case invalidBase64Payload
    case truncatedPayload
    case keyDerivationFailed

    public var errorDescription: String? {
        switch self {
        case .passphraseTooShort: return "رمز مشترک باید حداقل ۶ کاراکتر باشد."
        case .invalidBundlePrefix: return "فرمت بسته همگام‌سازی باید با mlmsync://v1/ شروع شود."
        case .invalidBase64Payload: return "داده Base64URL معتبر نیست."
        case .truncatedPayload: return "بسته همگام‌سازی ناقص یا آسیب‌دیده است."
        case .keyDerivationFailed: return "خطا در تولید کلید PBKDF2-SHA256."
        }
    }
}

/// Cross-platform encrypted bundle codec compatible with Windows Node (`sovereign-sync-manager.js`)
/// and Android Kotlin (`SovereignSyncManager.kt`) following `shared/sync-spec.json`.
public enum SovereignCryptoSync {

    private static let saltLen = 16
    private static let ivLen = 12
    private static let tagLen = 16

    public static func deriveKey(passphrase: String, salt: Data) throws -> SymmetricKey {
        let passData = Data(passphrase.utf8)
        var derived = Data(count: 32)
        let status = derived.withUnsafeMutableBytes { outPtr in
            salt.withUnsafeBytes { saltPtr in
                passData.withUnsafeBytes { passPtr in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passPtr.baseAddress?.assumingMemoryBound(to: Int8.self),
                        passData.count,
                        saltPtr.baseAddress?.assumingMemoryBound(to: UInt8.self),
                        salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        UInt32(SovereignConstants.pbkdf2Iterations),
                        outPtr.baseAddress?.assumingMemoryBound(to: UInt8.self),
                        32
                    )
                }
            }
        }
        guard status == kCCSuccess else {
            throw SovereignCryptoError.keyDerivationFailed
        }
        return SymmetricKey(data: derived)
    }

    public static func encryptBundle(snapshot: SovereignSnapshot, passphrase: String) throws -> String {
        guard passphrase.count >= 6 else { throw SovereignCryptoError.passphraseTooShort }
        let jsonData = try JSONEncoder().encode(snapshot)

        var salt = Data(count: saltLen)
        _ = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, saltLen, $0.baseAddress!) }

        var ivBytes = Data(count: ivLen)
        _ = ivBytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, ivLen, $0.baseAddress!) }

        let key = try deriveKey(passphrase: passphrase, salt: salt)
        let nonce = try AES.GCM.Nonce(data: ivBytes)
        let sealed = try AES.GCM.seal(jsonData, using: key, nonce: nonce, authenticating: SovereignConstants.syncAad)

        // Wire order: salt(16) || iv(12) || ciphertext(N) || authTag(16)
        var payload = Data()
        payload.append(salt)
        payload.append(ivBytes)
        payload.append(sealed.ciphertext)
        payload.append(sealed.tag)

        return SovereignConstants.syncPrefix + base64UrlEncode(payload)
    }

    public static func decryptBundle(bundleString: String, passphrase: String) throws -> SovereignSnapshot {
        let trimmed = bundleString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix(SovereignConstants.syncPrefix) else {
            throw SovereignCryptoError.invalidBundlePrefix
        }
        let b64Url = String(trimmed.dropFirst(SovereignConstants.syncPrefix.count))
        guard let blob = base64UrlDecode(b64Url) else {
            throw SovereignCryptoError.invalidBase64Payload
        }
        guard blob.count > saltLen + ivLen + tagLen else {
            throw SovereignCryptoError.truncatedPayload
        }

        let salt = blob.subdata(in: 0..<saltLen)
        let iv = blob.subdata(in: saltLen..<(saltLen + ivLen))
        let ctStart = saltLen + ivLen
        let ctEnd = blob.count - tagLen
        let ciphertext = blob.subdata(in: ctStart..<ctEnd)
        let tag = blob.subdata(in: ctEnd..<blob.count)

        let key = try deriveKey(passphrase: passphrase, salt: salt)
        let nonce = try AES.GCM.Nonce(data: iv)
        let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let plaintext = try AES.GCM.open(sealedBox, using: key, authenticating: SovereignConstants.syncAad)
        return try JSONDecoder().decode(SovereignSnapshot.self, from: plaintext)
    }

    private static func base64UrlEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func base64UrlDecode(_ str: String) -> Data? {
        var b64 = str
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let rem = b64.count % 4
        if rem > 0 { b64 += String(repeating: "=", count: 4 - rem) }
        return Data(base64Encoded: b64)
    }
}
