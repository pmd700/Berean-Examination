import Foundation
import CryptoKit
import Security
import Darwin

private let keychainService = "com.bereanexamination.activation-signing"
private let keychainAccount = "david-master-ed25519-v1"
private let signingKeyID = "david-ed25519-v1"
private let activationVersion = 1
private let activationProduct = "bex-launcher-official"

private enum GeneratorError: LocalizedError {
    case invalidCommand
    case invalidRequestCode
    case keyAlreadyExists
    case keyNotFound
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidCommand:
            return "Use: provision, status, public, or sign <request-code>."
        case .invalidRequestCode:
            return "The machine request code is not valid."
        case .keyAlreadyExists:
            return "The BEX signing key already exists in Keychain. It was not replaced."
        case .keyNotFound:
            return "The BEX signing key was not found in Keychain."
        case .keychain(let status):
            return "macOS Keychain returned error \(status)."
        }
    }
}

private func baseQuery() -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: keychainAccount,
    ]
}

private func keyExists() throws -> Bool {
    var query = baseQuery()
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess { return true }
    if status == errSecItemNotFound { return false }
    throw GeneratorError.keychain(status)
}

private func savePrivateKey(_ privateKeyData: Data) throws {
    if try keyExists() { throw GeneratorError.keyAlreadyExists }

    var query = baseQuery()
    query[kSecAttrLabel as String] = "BEX Activation Master Signing Key"
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    query[kSecValueData as String] = privateKeyData

    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw GeneratorError.keychain(status) }
}

private func loadPrivateKey() throws -> Curve25519.Signing.PrivateKey {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { throw GeneratorError.keyNotFound }
    guard status == errSecSuccess, let data = result as? Data else {
        throw GeneratorError.keychain(status)
    }
    return try Curve25519.Signing.PrivateKey(rawRepresentation: data)
}

private func publicKeyPEM(_ publicKey: Curve25519.Signing.PublicKey) -> String {
    let spkiPrefix: [UInt8] = [
        0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65,
        0x70, 0x03, 0x21, 0x00,
    ]
    var spki = Data(spkiPrefix)
    spki.append(publicKey.rawRepresentation)
    let body = spki.base64EncodedString(options: [.lineLength64Characters])
    return "-----BEGIN PUBLIC KEY-----\n\(body)\n-----END PUBLIC KEY-----"
}

private func isValidRequestCode(_ value: String) -> Bool {
    value.range(
        of: #"^BEX-REQ-1\.[A-Za-z0-9_-]{43}$"#,
        options: .regularExpression
    ) != nil
}

private func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func provision() throws {
    let privateKey = Curve25519.Signing.PrivateKey()
    try savePrivateKey(privateKey.rawRepresentation)
    print("KEY_ID=\(signingKeyID)")
    print(publicKeyPEM(privateKey.publicKey))
}

private func showStatus() throws {
    print(try keyExists() ? "KEYCHAIN_KEY_PRESENT" : "KEYCHAIN_KEY_ABSENT")
}

private func showPublicKey() throws {
    print("KEY_ID=\(signingKeyID)")
    print(publicKeyPEM(try loadPrivateKey().publicKey))
}

private func signRequest(_ requestCode: String) throws {
    guard isValidRequestCode(requestCode) else { throw GeneratorError.invalidRequestCode }
    let privateKey = try loadPrivateKey()

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    let payload: [String: Any] = [
        "issuedAt": formatter.string(from: Date()),
        "keyId": signingKeyID,
        "product": activationProduct,
        "requestCode": requestCode,
        "version": activationVersion,
    ]
    let payloadData = try JSONSerialization.data(
        withJSONObject: payload,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
    let signature = try privateKey.signature(for: payloadData)
    print("BEX-ACT-\(activationVersion).\(base64URL(payloadData)).\(base64URL(signature))")
}

do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    switch arguments.first {
    case "provision" where arguments.count == 1:
        try provision()
    case "status" where arguments.count == 1:
        try showStatus()
    case "public" where arguments.count == 1:
        try showPublicKey()
    case "sign" where arguments.count == 2:
        try signRequest(arguments[1])
    default:
        throw GeneratorError.invalidCommand
    }
} catch {
    let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

