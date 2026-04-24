package com.ftpanimeplayer.core.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * EncryptedSharedPreferences-backed credential storage so HTTP Basic
 * passwords aren't stored plaintext. One entry per (baseUrl, username).
 */
class CredentialStore(context: Context) {

    data class Credentials(val baseUrl: String, val username: String, val password: String)

    private val prefs = run {
        val master = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "ftp_anime_player_credentials",
            master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun load(): Credentials? {
        val url = prefs.getString(KEY_URL, null) ?: return null
        val user = prefs.getString(KEY_USER, null) ?: return null
        val pwd = prefs.getString(KEY_PWD, null) ?: return null
        return Credentials(url, user, pwd)
    }

    fun save(creds: Credentials) {
        prefs.edit()
            .putString(KEY_URL, creds.baseUrl)
            .putString(KEY_USER, creds.username)
            .putString(KEY_PWD, creds.password)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_URL = "baseUrl"
        private const val KEY_USER = "username"
        private const val KEY_PWD = "password"
    }
}
