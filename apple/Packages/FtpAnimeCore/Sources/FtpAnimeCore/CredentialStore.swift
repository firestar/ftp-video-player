import Foundation
#if canImport(Security)
import Security
#endif

/// Keychain-backed storage for backend credentials. Using the keychain means
/// the password survives reinstalls and is never written to plaintext
/// UserDefaults.
///
/// One shared service identifier `com.ftpanimeplayer.backend` holds a single
/// entry since the app talks to one backend at a time; if that changes, switch
/// to a per-backend account name.
public enum CredentialStore {

    public struct Credentials: Codable, Equatable, Sendable {
        public var baseURL: URL
        public var username: String
        public var password: String

        public init(baseURL: URL, username: String, password: String) {
            self.baseURL = baseURL; self.username = username; self.password = password
        }
    }

    private static let service = "com.ftpanimeplayer.backend"
    private static let account = "default"

    public static func save(_ credentials: Credentials) throws {
        let data = try JSONEncoder().encode(credentials)
        #if canImport(Security)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        var attrs = query
        attrs[kSecValueData as String] = data
        let status = SecItemAdd(attrs as CFDictionary, nil)
        if status != errSecSuccess {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        #else
        UserDefaults.standard.set(data, forKey: "\(service).\(account)")
        #endif
    }

    public static func load() -> Credentials? {
        #if canImport(Security)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
        #else
        guard let data = UserDefaults.standard.data(forKey: "\(service).\(account)") else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
        #endif
    }

    public static func clear() {
        #if canImport(Security)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        #else
        UserDefaults.standard.removeObject(forKey: "\(service).\(account)")
        #endif
    }
}
