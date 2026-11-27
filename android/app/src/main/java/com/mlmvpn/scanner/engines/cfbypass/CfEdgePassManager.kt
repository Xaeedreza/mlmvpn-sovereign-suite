package com.mlmvpn.scanner.engines.cfbypass

import android.content.Context
import android.util.Log
import androidx.preference.PreferenceManager
import com.mlmvpn.scanner.data.CloudAuth
import com.mlmvpn.scanner.data.CloudManager
import com.mlmvpn.scanner.engines.sanction.AntiSanctionManager
import com.mlmvpn.scanner.models.CloudAccount
import com.mlmvpn.scanner.utils.VpnConfig
import com.mlmvpn.scanner.utils.XrayJsonGenerator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Zero-VPN Cloudflare Edge Pass («سپر کلودفلر بدون فیلترشکن») for Android.
 *
 * Routes ONLY user-selected domains (and optionally selected Android packages) through
 * a Cloudflare Worker running `cf-edge-pass`, leaving domestic banking, local sites,
 * and everyday traffic untouched (`final = direct`).
 */
object CfEdgePassManager {

    private const val TAG = "CfEdgePassManager"
    const val NODE_ID = "__cf_edge_pass__"

    private const val PREFS_DOMAINS = "cf_bypass_domains_v1"
    private const val PREFS_ACTIVE_PACKS = "cf_bypass_packs_v1"
    private const val PREFS_WORKER_URL = "cf_bypass_worker_url_v1"
    private const val PREFS_CLEAN_IP = "cf_bypass_clean_ip_v1"
    private const val PREFS_UUID = "cf_bypass_uuid_v1"

    data class DomainPack(
        val id: String,
        val titleFa: String,
        val domains: List<String>,
    )

    val PRESET_PACKS = listOf(
        DomainPack(
            id = "ai_suite",
            titleFa = "هوش مصنوعی (ChatGPT / Claude / Gemini)",
            domains = listOf(
                "chatgpt.com", "openai.com", "oaistatic.com", "oaiusercontent.com",
                "claude.ai", "anthropic.com", "gemini.google.com", "aistudio.google.com",
                "generativelanguage.googleapis.com", "perplexity.ai", "copilot.microsoft.com",
            ),
        ),
        DomainPack(
            id = "dev_cloud",
            titleFa = "توسعه و کلود (GitHub / Docker / npm)",
            domains = listOf(
                "github.com", "api.github.com", "raw.githubusercontent.com", "ghcr.io",
                "registry.npmjs.org", "pypi.org", "hub.docker.com", "registry-1.docker.io",
                "android.googlesource.com", "dl.google.com", "maven.google.com",
            ),
        ),
        DomainPack(
            id = "social_media",
            titleFa = "شبکه‌های اجتماعی و رسانه",
            domains = listOf(
                "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com",
                "x.com", "twitter.com", "twimg.com", "instagram.com", "cdninstagram.com",
                "reddit.com", "spotify.com", "soundcloud.com",
            ),
        ),
        DomainPack(
            id = "gaming_login",
            titleFa = "لاگین گیمینگ و استور",
            domains = listOf(
                "store.steampowered.com", "steamcommunity.com", "epicgames.com",
                "riotgames.com", "auth.riotgames.com", "discord.com", "gateway.discord.gg",
                "play.google.com",
            ),
        ),
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    fun getEnabledPacks(context: Context): Set<String> {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val raw = prefs.getString(PREFS_ACTIVE_PACKS, "[\"ai_suite\"]") ?: "[\"ai_suite\"]"
        val out = linkedSetOf<String>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) out.add(arr.getString(i))
        } catch (_: Exception) {
            out.add("ai_suite")
        }
        return out
    }

    fun togglePack(context: Context, packId: String, enabled: Boolean) {
        val set = getEnabledPacks(context).toMutableSet()
        if (enabled) set.add(packId) else set.remove(packId)
        val arr = JSONArray()
        set.forEach { arr.put(it) }
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putString(PREFS_ACTIVE_PACKS, arr.toString()).apply()
    }

    fun getCustomDomains(context: Context): List<String> {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val raw = prefs.getString(PREFS_DOMAINS, "[]") ?: "[]"
        val out = linkedSetOf<String>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val d = normalizeDomain(arr.getString(i))
                if (d != null) out.add(d)
            }
        } catch (_: Exception) {}
        return out.toList()
    }

    fun addCustomDomain(context: Context, raw: String): Boolean {
        val d = normalizeDomain(raw) ?: return false
        val current = getCustomDomains(context).toMutableSet()
        current.add(d)
        val arr = JSONArray()
        current.sorted().forEach { arr.put(it) }
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putString(PREFS_DOMAINS, arr.toString()).apply()
        return true
    }

    fun removeCustomDomain(context: Context, domain: String) {
        val d = domain.trim().lowercase()
        val current = getCustomDomains(context).filterNot { it == d }
        val arr = JSONArray()
        current.forEach { arr.put(it) }
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putString(PREFS_DOMAINS, arr.toString()).apply()
    }

    fun getAllEffectiveDomains(context: Context): List<String> {
        val packs = getEnabledPacks(context)
        val out = linkedSetOf<String>()
        PRESET_PACKS.filter { it.id in packs }.forEach { out.addAll(it.domains) }
        out.addAll(getCustomDomains(context))
        return out.sorted()
    }

    fun getWorkerUrl(context: Context): String =
        PreferenceManager.getDefaultSharedPreferences(context).getString(PREFS_WORKER_URL, "")?.trim().orEmpty()

    fun setWorkerUrl(context: Context, url: String) {
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putString(PREFS_WORKER_URL, url.trim().removeSuffix("/")).apply()
    }

    fun getCleanIp(context: Context): String =
        PreferenceManager.getDefaultSharedPreferences(context).getString(PREFS_CLEAN_IP, "")?.trim().orEmpty()

    fun setCleanIp(context: Context, ip: String) {
        PreferenceManager.getDefaultSharedPreferences(context).edit()
            .putString(PREFS_CLEAN_IP, ip.trim()).apply()
    }

    fun getOrCreateUuid(context: Context): String {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val existing = prefs.getString(PREFS_UUID, null)
        if (!existing.isNullOrBlank()) return existing
        val created = UUID.randomUUID().toString()
        prefs.edit().putString(PREFS_UUID, created).apply()
        return created
    }

    fun setUuid(context: Context, uuid: String) {
        if (uuid.isNotBlank()) {
            PreferenceManager.getDefaultSharedPreferences(context).edit()
                .putString(PREFS_UUID, uuid.trim()).apply()
        }
    }

    fun normalizeDomain(input: String): String? {
        var s = input.trim().lowercase()
        if (s.isEmpty()) return null
        s = s.removePrefix("https://").removePrefix("http://")
        s = s.substringBefore('/').substringBefore(':').removePrefix("*.")
        return s.takeIf { it.contains('.') && !it.contains(' ') && it.length <= 253 }
    }

    /**
     * Build a split-tunnel Xray configuration using either a dedicated Edge Pass worker
     * or an existing EDG worker from CloudManager. Only the chosen domains/apps traverse
     * the Cloudflare edge; all other traffic breaks out direct.
     */
    suspend fun buildSplitTunnelConfig(context: Context, localPort: Int): String? = withContext(Dispatchers.IO) {
        val workerUrl = getWorkerUrl(context)
        val uuid = getOrCreateUuid(context)
        val cleanIp = getCleanIp(context)

        val vlessUri = if (workerUrl.isNotBlank()) {
            val host = workerUrl.removePrefix("https://").removePrefix("http://").substringBefore('/')
            val addr = if (cleanIp.isNotBlank()) cleanIp else host
            val path = "/?ed=2560"
            "vless://$uuid@$addr:443?encryption=none&security=tls&sni=$host&fp=chrome&type=ws&host=$host&path=$path#CF-Edge-Pass"
        } else {
            AntiSanctionManager.getExitVless(context)
        } ?: return@withContext null

        val parsed = VpnConfig.parseUri(vlessUri) ?: return@withContext null
        val routingDomains = getAllEffectiveDomains(context).map { "domain:$it" }
        val apps = AntiSanctionManager.routedPackages(context)
        if (routingDomains.isEmpty() && apps.isEmpty()) return@withContext null

        XrayJsonGenerator.generateAntiSanctionConfig(
            config = parsed,
            localPort = localPort,
            sanctionedDomains = routingDomains,
            backendDns = "1.1.1.1",
            proxyEverything = apps.isNotEmpty(),
        )
    }

    /**
     * Deploy `assets/cf_edge_pass_worker.js` directly onto the user's Cloudflare account
     * using Cloudflare Workers API v4 (ES module upload + workers.dev route activation).
     */
    suspend fun deployEdgePassWorker(
        context: Context,
        account: CloudAccount,
        workerName: String = "mlm-edge-pass",
        proxyIp: String = "",
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        try {
            val scriptSrc = context.assets.open("cf_edge_pass_worker.js").bufferedReader().use { it.readText() }
            val uuid = getOrCreateUuid(context)

            val bindings = JSONArray().apply {
                put(JSONObject().apply {
                    put("name", "UUID")
                    put("type", "plain_text")
                    put("text", uuid)
                })
                if (proxyIp.isNotBlank()) {
                    put(JSONObject().apply {
                        put("name", "PROXYIP")
                        put("type", "plain_text")
                        put("text", proxyIp.trim())
                    })
                }
            }
            val metadata = JSONObject().apply {
                put("main_module", "worker.js")
                put("compatibility_date", "2024-11-01")
                put("bindings", bindings)
            }

            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "metadata",
                    null,
                    metadata.toString().toRequestBody("application/json".toMediaType()),
                )
                .addFormDataPart(
                    "worker.js",
                    "worker.js",
                    scriptSrc.toRequestBody("application/javascript+module".toMediaType()),
                )
                .build()

            val headers = CloudAuth.headers(account)
            val putReq = Request.Builder()
                .url("https://api.cloudflare.com/client/v4/accounts/${account.accountId}/workers/scripts/$workerName")
                .apply {
                    for (i in 0 until headers.size) {
                        val name = headers.name(i)
                        if (!name.equals("Content-Type", ignoreCase = true)) {
                            addHeader(name, headers.value(i))
                        }
                    }
                }
                .put(body)
                .build()

            client.newCall(putReq).execute().use { resp ->
                val txt = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    return@withContext false to "CF API ${resp.code}: ${txt.take(220)}"
                }
            }

            // Enable workers.dev subdomain for this script
            val enableBody = """{"enabled":true}""".toRequestBody("application/json".toMediaType())
            val subEnableReq = Request.Builder()
                .url("https://api.cloudflare.com/client/v4/accounts/${account.accountId}/workers/scripts/$workerName/subdomain")
                .headers(headers)
                .post(enableBody)
                .build()
            client.newCall(subEnableReq).execute().close()

            // Fetch subdomain prefix
            var subPrefix = account.name.lowercase().replace(Regex("[^a-z0-9-]"), "")
            val subReq = Request.Builder()
                .url("https://api.cloudflare.com/client/v4/accounts/${account.accountId}/workers/subdomain")
                .headers(headers)
                .get()
                .build()
            client.newCall(subReq).execute().use { r ->
                if (r.isSuccessful) {
                    val obj = JSONObject(r.body?.string().orEmpty())
                    val s = obj.optJSONObject("result")?.optString("subdomain")
                    if (!s.isNullOrBlank()) subPrefix = s
                }
            }

            val finalUrl = "https://$workerName.$subPrefix.workers.dev"
            setWorkerUrl(context, finalUrl)
            true to finalUrl
        } catch (e: Exception) {
            Log.e(TAG, "deployEdgePassWorker error", e)
            false to (e.message ?: "Deploy error")
        }
    }

    data class ProbeResult(
        val domain: String,
        val directStatus: String,
        val directMs: Long,
        val edgeStatus: String,
        val edgeMs: Long,
    )

    suspend fun probeDomain(context: Context, rawDomain: String): ProbeResult = withContext(Dispatchers.IO) {
        val domain = normalizeDomain(rawDomain) ?: rawDomain.trim()
        val t0 = System.currentTimeMillis()
        val directStatus = try {
            val s = Socket()
            s.connect(InetSocketAddress(domain, 443), 4000)
            s.soTimeout = 4000
            val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
            val ssl = factory.createSocket(s, domain, 443, true) as SSLSocket
            try {
                val p = ssl.sslParameters
                p.serverNames = listOf(SNIHostName(domain))
                ssl.sslParameters = p
            } catch (_: Exception) {}
            ssl.startHandshake()
            ssl.outputStream.write("HEAD / HTTP/1.1\r\nHost: $domain\r\nConnection: close\r\n\r\n".toByteArray())
            val firstLine = ssl.inputStream.bufferedReader().readLine() ?: "closed"
            ssl.close()
            firstLine.take(36)
        } catch (e: Exception) {
            "Blocked/Err: ${e.javaClass.simpleName}"
        }
        val directMs = System.currentTimeMillis() - t0

        val workerUrl = getWorkerUrl(context)
        val t1 = System.currentTimeMillis()
        val edgeStatus = if (workerUrl.isBlank()) {
            "ورکر تنظیم نشده"
        } else {
            try {
                val req = Request.Builder().url("$workerUrl/_edge/https://$domain/").get().build()
                client.newCall(req).execute().use { r -> "HTTP ${r.code}" }
            } catch (e: Exception) {
                "Err: ${e.javaClass.simpleName}"
            }
        }
        val edgeMs = System.currentTimeMillis() - t1

        ProbeResult(domain, directStatus, directMs, edgeStatus, edgeMs)
    }
}
