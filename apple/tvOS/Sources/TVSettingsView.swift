import SwiftUI
import FtpAnimeCore

struct TVSettingsView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if let creds = appModel.credentials {
                Text("Connected to").font(.headline).foregroundStyle(.secondary)
                Text(creds.baseURL.absoluteString).font(.title2)
                Text("User: \(creds.username)").font(.title3).foregroundStyle(.secondary)
                Button("Sign out", role: .destructive) { appModel.signOut() }
            } else {
                Text("Not connected.")
            }
        }
        .padding(60)
    }
}
