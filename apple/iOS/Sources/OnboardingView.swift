import SwiftUI
import FtpAnimeCore

/// First-run setup: asks for the backend URL + HTTP Basic credentials.
/// Saves into the keychain via `CredentialStore` and bootstraps the
/// `LibraryStore` on submit.
struct OnboardingView: View {

    @EnvironmentObject private var appModel: AppModel

    @State private var baseURL: String = "http://"
    @State private var username: String = ""
    @State private var password: String = ""
    @State private var errorMessage: String?
    @State private var isBusy: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Backend") {
                    TextField("Base URL (e.g. http://nas.local:8080)", text: $baseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Username", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        Task { await connect() }
                    } label: {
                        if isBusy { ProgressView() } else { Text("Connect") }
                    }
                    .disabled(baseURL.isEmpty || username.isEmpty || isBusy)
                }
            }
            .navigationTitle("Set up backend")
        }
    }

    private func connect() async {
        guard let url = URL(string: baseURL) else {
            errorMessage = "Invalid URL"
            return
        }
        isBusy = true
        defer { isBusy = false }
        let credentials = CredentialStore.Credentials(baseURL: url, username: username, password: password)
        // Round-trip a harmless endpoint to verify credentials before saving.
        let client = ApiClient(configuration: .init(baseURL: url, username: username, password: password))
        do {
            _ = try await client.listServers()
            await appModel.save(credentials: credentials)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
