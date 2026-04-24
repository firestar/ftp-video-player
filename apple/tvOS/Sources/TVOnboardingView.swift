import SwiftUI
import FtpAnimeCore

struct TVOnboardingView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var baseURL: String = "http://"
    @State private var username: String = ""
    @State private var password: String = ""
    @State private var errorMessage: String?
    @State private var isBusy: Bool = false

    var body: some View {
        VStack(spacing: 24) {
            Text("Connect to backend").font(.largeTitle.bold())
            VStack(alignment: .leading, spacing: 12) {
                TextField("Base URL", text: $baseURL)
                TextField("Username", text: $username)
                SecureField("Password", text: $password)
            }
            .frame(maxWidth: 600)
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            Button { Task { await connect() } } label: {
                if isBusy { ProgressView() } else { Text("Connect").padding(.horizontal, 40) }
            }
            .disabled(baseURL.isEmpty || username.isEmpty || isBusy)
        }
        .padding(60)
    }

    private func connect() async {
        guard let url = URL(string: baseURL) else {
            errorMessage = "Invalid URL"; return
        }
        isBusy = true
        defer { isBusy = false }
        let creds = CredentialStore.Credentials(baseURL: url, username: username, password: password)
        let client = ApiClient(configuration: .init(baseURL: url, username: username, password: password))
        do {
            _ = try await client.listServers()
            await appModel.save(creds)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
