import Foundation
import CryptoKit
import Security
import Darwin

private let keychainService = "com.bereanexamination.course-publishing-signing"
private let keychainAccount = "david-course-ed25519-v1"
private let signingKeyID = "david-course-ed25519-v1"

private enum SignerError: LocalizedError {
    case invalidCommand
    case invalidManifest
    case keyAlreadyExists
    case keyNotFound
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidCommand:
            return "Use: provision, status, public, sign, or sign-catalog. Signing commands read one canonical unsigned BEX document from standard input."
        case .invalidManifest:
            return "Course Studio refused to sign data that is not one canonical unsigned BEX Course manifest."
        case .keyAlreadyExists:
            return "The BEX Course publishing key already exists in Keychain. It was not replaced."
        case .keyNotFound:
            return "The BEX Course publishing key was not found in Keychain."
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
    throw SignerError.keychain(status)
}

private func savePrivateKey(_ data: Data) throws {
    if try keyExists() { throw SignerError.keyAlreadyExists }
    var query = baseQuery()
    query[kSecAttrLabel as String] = "BEX Course Publishing Master Signing Key"
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    query[kSecValueData as String] = data
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw SignerError.keychain(status) }
}

private func loadPrivateKey() throws -> Curve25519.Signing.PrivateKey {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { throw SignerError.keyNotFound }
    guard status == errSecSuccess, let data = result as? Data else { throw SignerError.keychain(status) }
    return try Curve25519.Signing.PrivateKey(rawRepresentation: data)
}

private func publicKeyPEM(_ publicKey: Curve25519.Signing.PublicKey) -> String {
    let prefix: [UInt8] = [0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70, 0x03, 0x21, 0x00]
    var spki = Data(prefix)
    spki.append(publicKey.rawRepresentation)
    let body = spki.base64EncodedString(options: [.lineLength64Characters])
    return "-----BEGIN PUBLIC KEY-----\n\(body)\n-----END PUBLIC KEY-----"
}

private func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func validatedInput(format: String, versionKey: String) throws -> Data {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count >= 2 && data.count <= 1_048_576,
          let value = try? JSONSerialization.jsonObject(with: data),
          let manifest = value as? [String: Any],
          manifest["format"] as? String == format,
          manifest[versionKey] as? Int == 1,
          manifest["signature"] is NSNull,
          let canonical = try? JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys, .withoutEscapingSlashes]),
          canonical == data else {
        throw SignerError.invalidManifest
    }
    return data
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

private func signDocument(format: String, versionKey: String) throws {
    let input = try validatedInput(format: format, versionKey: versionKey)
    let signature = try loadPrivateKey().signature(for: input)
    print("KEY_ID=\(signingKeyID)")
    print("SIGNATURE=\(base64URL(signature))")
}

do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    switch arguments.first {
    case "provision" where arguments.count == 1: try provision()
    case "status" where arguments.count == 1: try showStatus()
    case "public" where arguments.count == 1: try showPublicKey()
    case "sign" where arguments.count == 1: try signDocument(format: "bex-course", versionKey: "manifestVersion")
    case "sign-catalog" where arguments.count == 1: try signDocument(format: "bex-course-catalog", versionKey: "catalogVersion")
    default: throw SignerError.invalidCommand
    }
} catch {
    let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
