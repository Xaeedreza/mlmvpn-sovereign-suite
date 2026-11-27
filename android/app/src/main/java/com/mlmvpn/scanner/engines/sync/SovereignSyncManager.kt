package com.mlmvpn.scanner.engines.sync

import android.content.Context
import android.util.Base64
import com.mlmvpn.scanner.data.CloudManager
import com.mlmvpn.scanner.engines.cfbypass.CfEdgePassManager
import com.mlmvpn.scanner.engines.sanction.AntiSanctionManager
import com.mlmvpn.scanner.models.CloudAccount
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Cross-device encrypted Sovereign Sync implementing the exact `mlmsync://v1/`
 * binary specification from `shared/sync-spec.json`.
 *
 * Wire format:
 *   `mlmsync://v1/` + base64url( salt(16) || iv(12) || ciphertext(N) || authTag(16) )
 * KDF: PBKDF2WithHmacSHA256, 100_000 iterations, 256-bit key
 * AEAD: AES/GCM/NoPadding, 128-bit tag, AAD = "mlmvpn-sovereign-sync-v1" UTF-8
 */
object SovereignSyncManager {

    private const val PREFIX = "mlmsync://v1/"
    private const val SALT_LEN = 16
    private const val IV_LEN = 12
    private const val TAG_BITS = 128
    private const val PBKDF2_ITERATIONS = 100_000
    private val AAD = "mlmvpn-sovereign-sync-v1".toByteArray(Charsets.UTF_8)

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    fun exportSnapshot(context: Context): JSONObject {
        val cloud = CloudManager(context)
        val accountsArr = JSONArray()
        for (a in cloud.accountsFlow.value) {
            accountsArr.put(JSONObject().apply {
                put("id", a.id)
                put("name", a.name)
                put("email", a.email)
                put("token", a.token)
                put("accountId", a.accountId)
                put("workerUrl", a.workerUrl ?: "")
                put("edgWorkerUrl", a.edgWorkerUrl ?: "")
                put("edgUuid", a.edgUuid ?: "")
                put("mlmWorkerUrl", a.mlmWorkerUrl ?: "")
                put("nahanWorkerUrl", a.nahanWorkerUrl ?: "")
            })
        }

        val cfBypassObj = JSONObject().apply {
            put("workerUrl", CfEdgePassManager.getWorkerUrl(context))
            put("cleanIp", CfEdgePassManager.getCleanIp(context))
            put("uuid", CfEdgePassManager.getOrCreateUuid(context))
            put("packs", JSONArray(CfEdgePassManager.getEnabledPacks(context).toList()))
            put("customDomains", JSONArray(CfEdgePassManager.getCustomDomains(context)))
        }

        val sanctionArr = JSONArray(AntiSanctionManager.getDomains(context))

        return JSONObject().apply {
            put("schema", 1)
            put("platform", "android")
            put("exportedAt", System.currentTimeMillis())
            put("accounts", accountsArr)
            put("cfBypass", cfBypassObj)
            put("sanctionDomains", sanctionArr)
        }
    }

    fun applySnapshot(context: Context, snapshot: JSONObject): Map<String, Int> {
        var addedAccounts = 0
        var addedDomains = 0

        snapshot.optJSONObject("cfBypass")?.let { cf ->
            val w = cf.optString("workerUrl")
            if (w.isNotBlank()) CfEdgePassManager.setWorkerUrl(context, w)
            val ip = cf.optString("cleanIp")
            if (ip.isNotBlank()) CfEdgePassManager.setCleanIp(context, ip)
            val uid = cf.optString("uuid")
            if (uid.isNotBlank()) CfEdgePassManager.setUuid(context, uid)

            cf.optJSONArray("packs")?.let { arr ->
                for (i in 0 until arr.length()) {
                    CfEdgePassManager.togglePack(context, arr.getString(i), true)
                }
            }
            cf.optJSONArray("customDomains")?.let { arr ->
                for (i in 0 until arr.length()) {
                    if (CfEdgePassManager.addCustomDomain(context, arr.getString(i))) addedDomains++
                }
            }
        }

        snapshot.optJSONArray("sanctionDomains")?.let { arr ->
            for (i in 0 until arr.length()) {
                val d = arr.getString(i).trim()
                if (d.isNotBlank()) AntiSanctionManager.addDomain(context, d)
            }
        }

        snapshot.optJSONArray("accounts")?.let { arr ->
            val cloud = CloudManager(context)
            val existingIds = cloud.accountsFlow.value.map { it.accountId }.toSet()
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val accountId = obj.optString("accountId").trim()
                val token = obj.optString("token").trim()
                if (accountId.isBlank() || token.isBlank() || accountId in existingIds) continue
                val acct = CloudAccount(
                    id = obj.optString("id").ifBlank { UUID.randomUUID().toString() },
                    token = token,
                    email = obj.optString("email"),
                    name = obj.optString("name").ifBlank { "Synced CF" },
                    accountId = accountId,
                    status = "active",
                    addedAt = System.currentTimeMillis().toString(),
                    workerUrl = obj.optString("workerUrl").ifBlank { null },
                    edgWorkerUrl = obj.optString("edgWorkerUrl").ifBlank { null },
                    edgUuid = obj.optString("edgUuid").ifBlank { null },
                    mlmWorkerUrl = obj.optString("mlmWorkerUrl").ifBlank { null },
                    nahanWorkerUrl = obj.optString("nahanWorkerUrl").ifBlank { null },
                )
                cloud.addSyncedAccount(acct)
                addedAccounts++
            }
        }

        return mapOf("accounts" to addedAccounts, "domains" to addedDomains)
    }

    private fun deriveKey(passphrase: String, salt: ByteArray): SecretKeySpec {
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, PBKDF2_ITERATIONS, 256)
        val keyBytes = factory.generateSecret(spec).encoded
        return SecretKeySpec(keyBytes, "AES")
    }

    fun encryptBundle(snapshot: JSONObject, passphrase: String): String {
        require(passphrase.length >= 6) { "Passphrase must be at least 6 characters" }
        val rng = SecureRandom()
        val salt = ByteArray(SALT_LEN).also { rng.nextBytes(it) }
        val iv = ByteArray(IV_LEN).also { rng.nextBytes(it) }
        val key = deriveKey(passphrase, salt)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(AAD)
        val encryptedWithTag = cipher.doFinal(snapshot.toString().toByteArray(Charsets.UTF_8))

        val blob = ByteArray(SALT_LEN + IV_LEN + encryptedWithTag.size)
        System.arraycopy(salt, 0, blob, 0, SALT_LEN)
        System.arraycopy(iv, 0, blob, SALT_LEN, IV_LEN)
        System.arraycopy(encryptedWithTag, 0, blob, SALT_LEN + IV_LEN, encryptedWithTag.size)

        val encoded = Base64.encodeToString(blob, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        return "$PREFIX$encoded"
    }

    fun decryptBundle(bundleString: String, passphrase: String): JSONObject {
        val raw = bundleString.trim().removePrefix(PREFIX)
        val blob = Base64.decode(raw, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        require(blob.size > SALT_LEN + IV_LEN + 16) { "Invalid mlmsync payload" }

        val salt = blob.copyOfRange(0, SALT_LEN)
        val iv = blob.copyOfRange(SALT_LEN, SALT_LEN + IV_LEN)
        val encryptedWithTag = blob.copyOfRange(SALT_LEN + IV_LEN, blob.size)
        val key = deriveKey(passphrase, salt)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(AAD)
        val plain = cipher.doFinal(encryptedWithTag)
        return JSONObject(String(plain, Charsets.UTF_8))
    }

    suspend fun pushToCfKv(
        context: Context,
        workerUrl: String,
        syncKey: String,
        passphrase: String,
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        try {
            val cleanWorker = workerUrl.trim().removeSuffix("/")
            val bundle = encryptBundle(exportSnapshot(context), passphrase)
            val payload = JSONObject().apply {
                put("key", syncKey.trim())
                put("bundle", bundle)
            }.toString()
            val req = Request.Builder()
                .url("$cleanWorker/sync/push")
                .post(payload.toRequestBody("application/json".toMediaType()))
                .build()
            client.newCall(req).execute().use { r ->
                val txt = r.body?.string().orEmpty()
                if (r.isSuccessful) true to "ذخیره شد در Cloudflare KV" else false to "HTTP ${r.code}: ${txt.take(150)}"
            }
        } catch (e: Exception) {
            false to (e.message ?: "Sync push error")
        }
    }

    suspend fun pullFromCfKv(
        context: Context,
        workerUrl: String,
        syncKey: String,
        passphrase: String,
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        try {
            val cleanWorker = workerUrl.trim().removeSuffix("/")
            val req = Request.Builder()
                .url("$cleanWorker/sync/pull?key=${java.net.URLEncoder.encode(syncKey.trim(), "UTF-8")}")
                .get()
                .build()
            client.newCall(req).execute().use { r ->
                val txt = r.body?.string().orEmpty()
                if (!r.isSuccessful) return@withContext false to "HTTP ${r.code}: ${txt.take(150)}"
                val obj = JSONObject(txt)
                val bundle = obj.optString("bundle")
                val snap = decryptBundle(bundle, passphrase)
                val stats = applySnapshot(context, snap)
                true to "همگام‌سازی کامل شد: +${stats["accounts"]} اکانت، +${stats["domains"]} دامنه"
            }
        } catch (e: Exception) {
            false to (e.message ?: "Sync pull/decrypt error")
        }
    }

    suspend fun pushToGist(
        context: Context,
        githubToken: String,
        passphrase: String,
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        try {
            val bundle = encryptBundle(exportSnapshot(context), passphrase)
            val payload = JSONObject().apply {
                put("description", "MLMVPN Sovereign Sync Encrypted Vault")
                put("public", false)
                put("files", JSONObject().put("mlmvpn-sync.txt", JSONObject().put("content", bundle)))
            }.toString()
            val req = Request.Builder()
                .url("https://api.github.com/gists")
                .addHeader("Authorization", "Bearer ${githubToken.trim()}")
                .addHeader("Accept", "application/vnd.github+json")
                .post(payload.toRequestBody("application/json".toMediaType()))
                .build()
            client.newCall(req).execute().use { r ->
                val txt = r.body?.string().orEmpty()
                if (!r.isSuccessful) return@withContext false to "GitHub ${r.code}: ${txt.take(150)}"
                val id = JSONObject(txt).optString("id")
                true to id
            }
        } catch (e: Exception) {
            false to (e.message ?: "Gist push error")
        }
    }

    suspend fun pullFromGist(
        context: Context,
        githubToken: String,
        gistId: String,
        passphrase: String,
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url("https://api.github.com/gists/${gistId.trim()}")
                .apply {
                    if (githubToken.isNotBlank()) addHeader("Authorization", "Bearer ${githubToken.trim()}")
                    addHeader("Accept", "application/vnd.github+json")
                }
                .get()
                .build()
            client.newCall(req).execute().use { r ->
                val txt = r.body?.string().orEmpty()
                if (!r.isSuccessful) return@withContext false to "GitHub ${r.code}: ${txt.take(150)}"
                val files = JSONObject(txt).optJSONObject("files")
                val bundle = files?.optJSONObject("mlmvpn-sync.txt")?.optString("content").orEmpty()
                val snap = decryptBundle(bundle, passphrase)
                val stats = applySnapshot(context, snap)
                true to "از Gist وارد شد: +${stats["accounts"]} اکانت، +${stats["domains"]} دامنه"
            }
        } catch (e: Exception) {
            false to (e.message ?: "Gist pull/decrypt error")
        }
    }
}
