import SwiftUI
import FtpAnimeCore

struct SettingsView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        Form {
            Section("Backend") {
                if let creds = appModel.credentials {
                    LabeledContent("URL", value: creds.baseURL.absoluteString)
                    LabeledContent("User", value: creds.username)
                    Button("Sign out", role: .destructive) { appModel.signOut() }
                } else {
                    Text("Not connected.")
                }
            }
            Section("Servers") {
                if let store = appModel.store {
                    ForEach(store.servers) { server in
                        VStack(alignment: .leading) {
                            Text(server.name).font(.headline)
                            Text("\(server.protocol.rawValue.uppercased())  \(server.host):\(server.port)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                NavigationLink("Add server") { AddServerView() }
            }
        }
        .navigationTitle("Settings")
    }
}

struct AddServerView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var proto: FtpProtocol = .sftp
    @State private var host: String = ""
    @State private var port: String = "22"
    @State private var username: String = ""
    @State private var password: String = ""
    @State private var errorMessage: String?
    @State private var isBusy: Bool = false

    var body: some View {
        Form {
            Section("Server") {
                TextField("Name", text: $name)
                Picker("Protocol", selection: $proto) {
                    Text("SFTP").tag(FtpProtocol.sftp)
                    Text("FTP").tag(FtpProtocol.ftp)
                    Text("FTPS").tag(FtpProtocol.ftps)
                }
                TextField("Host", text: $host).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Port", text: $port).keyboardType(.numberPad)
                TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Password", text: $password)
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
            Button {
                Task { await save() }
            } label: {
                if isBusy { ProgressView() } else { Text("Save") }
            }
            .disabled(name.isEmpty || host.isEmpty || isBusy)
        }
        .navigationTitle("Add server")
    }

    private func save() async {
        guard let store = appModel.store else { return }
        isBusy = true
        defer { isBusy = false }
        let cfg = FtpServerConfig(id: UUID().uuidString, name: name, protocol: proto,
                                   host: host, port: Int(port) ?? 22,
                                   username: username, password: password)
        await store.upsertServer(cfg)
        dismiss()
    }
}
