package com.mlmvpn.scanner.ui.cfbypass

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mlmvpn.scanner.MyVpnService
import com.mlmvpn.scanner.R
import com.mlmvpn.scanner.data.CloudManager
import com.mlmvpn.scanner.data.ScanGuard
import com.mlmvpn.scanner.engines.cfbypass.CfEdgePassManager
import com.mlmvpn.scanner.ui.settings.Ios
import com.mlmvpn.scanner.ui.settings.IosScreen
import com.mlmvpn.scanner.ui.settings.SettingsActionRow
import com.mlmvpn.scanner.ui.settings.SettingsFooter
import com.mlmvpn.scanner.ui.settings.SettingsGroup
import com.mlmvpn.scanner.ui.settings.SettingsRow
import com.mlmvpn.scanner.ui.settings.SettingsSectionHeader
import com.mlmvpn.scanner.utils.LocalPort
import com.mlmvpn.scanner.utils.NetworkSettings
import com.mlmvpn.scanner.utils.SafeStart
import kotlinx.coroutines.launch

@Composable
fun CfEdgePassScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val cloud = remember { CloudManager(context) }
    val accounts by cloud.accountsFlow.collectAsState()

    val phase by MyVpnService.connectionPhaseFlow.collectAsState()
    val connectedNode by MyVpnService.connectedNodeIdFlow.collectAsState()
    val isOurs = connectedNode == CfEdgePassManager.NODE_ID
    val isActive = isOurs && phase == MyVpnService.Phase.CONNECTED
    val isConnecting = isOurs && phase == MyVpnService.Phase.CONNECTING

    var enabledPacks by remember { mutableStateOf(CfEdgePassManager.getEnabledPacks(context)) }
    var customDomains by remember { mutableStateOf(CfEdgePassManager.getCustomDomains(context)) }
    var newDomainInput by remember { mutableStateOf("") }
    var workerUrl by remember { mutableStateOf(CfEdgePassManager.getWorkerUrl(context)) }
    var cleanIp by remember { mutableStateOf(CfEdgePassManager.getCleanIp(context)) }

    var deploying by remember { mutableStateOf(false) }
    var pendingConfig by remember { mutableStateOf<String?>(null) }
    var probeInput by remember { mutableStateOf("chatgpt.com") }
    var probing by remember { mutableStateOf(false) }
    var probeResult by remember { mutableStateOf<CfEdgePassManager.ProbeResult?>(null) }

    fun startService(cfg: String) {
        val intent = Intent(context, MyVpnService::class.java).apply {
            putExtra("NODE_URI", cfg)
            putExtra("MTU_PROFILE", NetworkSettings.Method.ANTI_SANCTION.id)
            putExtra("NODE_ID", CfEdgePassManager.NODE_ID)
            putExtra("PROXY_MODE", NetworkSettings.proxyMode(context))
            putExtra("LOCAL_PORT", LocalPort.getString(context))
        }
        SafeStart.service(context, intent)
    }

    val vpnPrepareLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { res ->
        if (res.resultCode == Activity.RESULT_OK) {
            pendingConfig?.let { startService(it) }
        }
        pendingConfig = null
    }

    LaunchedEffect(phase) {
        if (phase == MyVpnService.Phase.CONNECTED || phase == MyVpnService.Phase.FAILED) {
            pendingConfig = null
        }
    }

    fun toggleShield() {
        if (isActive || isConnecting) {
            val stop = Intent(context, MyVpnService::class.java).apply { action = "STOP" }
            SafeStart.service(context, stop)
            return
        }
        ScanGuard.run(ScanGuard.Reason.CONNECT_VPN) {
            scope.launch {
                val cfg = CfEdgePassManager.buildSplitTunnelConfig(context, LocalPort.get(context))
                if (cfg == null) {
                    Toast.makeText(
                        context,
                        "ابتدا یک ورکر سپر کلودفلر یا حساب ابری اضافه و نصب کنید",
                        Toast.LENGTH_LONG,
                    ).show()
                    return@launch
                }
                pendingConfig = cfg
                val prep = try { VpnService.prepare(context) } catch (_: Exception) { null }
                if (prep != null) vpnPrepareLauncher.launch(prep)
                else {
                    startService(cfg)
                    pendingConfig = null
                }
            }
        }
    }

    IosScreen(
        title = stringResource(R.string.cf_bypass_title),
        onBack = onBack,
    ) {
        // Warm Velvet Sovereign Hero Card
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(
                    Brush.linearGradient(
                        if (isActive) {
                            listOf(Color(0xFF2E6F4E), Color(0xFF1E3F31))
                        } else {
                            listOf(Color(0xFF7B3345), Color(0xFF471F2C))
                        },
                    ),
                )
                .clickable { toggleShield() }
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(54.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color.White.copy(alpha = 0.16f)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (isConnecting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(26.dp),
                            color = Color.White,
                            strokeWidth = 2.5.dp,
                        )
                    } else {
                        Icon(
                            Icons.Default.PowerSettingsNew,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(28.dp),
                        )
                    }
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = if (isActive) stringResource(R.string.cf_bypass_enabled)
                        else if (isConnecting) "در حال اتصال سپر لبه..."
                        else stringResource(R.string.cf_bypass_disabled),
                        color = Color.White,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(4.dp))
                    val total = CfEdgePassManager.getAllEffectiveDomains(context).size
                    Text(
                        text = "${total} دامنه انتخابی فقط از کلودفلر عبور می‌کنند؛ بانک‌ها و سایت‌های داخلی مستقیم می‌مانند.",
                        color = Color.White.copy(alpha = 0.80f),
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                    )
                }
            }
        }

        // Preset packs
        SettingsSectionHeader(stringResource(R.string.cf_bypass_packs_title))
        SettingsGroup {
            CfEdgePassManager.PRESET_PACKS.forEachIndexed { idx, pack ->
                val checked = pack.id in enabledPacks
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            CfEdgePassManager.togglePack(context, pack.id, !checked)
                            enabledPacks = CfEdgePassManager.getEnabledPacks(context)
                        }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.FlashOn,
                        contentDescription = null,
                        tint = Color(0xFFE88B5A),
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(pack.titleFa, color = Ios.Label, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        Text("${pack.domains.size} دامنه", color = Ios.SecondaryLabel, fontSize = 12.sp)
                    }
                    Switch(
                        checked = checked,
                        onCheckedChange = {
                            CfEdgePassManager.togglePack(context, pack.id, it)
                            enabledPacks = CfEdgePassManager.getEnabledPacks(context)
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = Color(0xFFE07A5F),
                        ),
                    )
                }
                if (idx < CfEdgePassManager.PRESET_PACKS.lastIndex) {
                    Box(Modifier.fillMaxWidth().padding(start = 48.dp).height(0.5.dp).background(Ios.Separator))
                }
            }
        }

        // Custom domains
        SettingsSectionHeader("دامنه‌های اختصاصی شما")
        SettingsGroup {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Language, contentDescription = null, tint = Ios.Teal, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = newDomainInput,
                    onValueChange = { newDomainInput = it },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 15.sp),
                    cursorBrush = SolidColor(Color(0xFFE88B5A)),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (newDomainInput.isEmpty()) {
                            Text(stringResource(R.string.cf_bypass_domains_hint), color = Ios.SecondaryLabel, fontSize = 14.sp)
                        }
                        inner()
                    },
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFFE07A5F))
                        .clickable {
                            if (CfEdgePassManager.addCustomDomain(context, newDomainInput)) {
                                newDomainInput = ""
                                customDomains = CfEdgePassManager.getCustomDomains(context)
                            } else {
                                Toast.makeText(context, "دامنه معتبر وارد کنید", Toast.LENGTH_SHORT).show()
                            }
                        }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                }
            }
            for (dom in customDomains) {
                Box(Modifier.fillMaxWidth().padding(start = 48.dp).height(0.5.dp).background(Ios.Separator))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Check, contentDescription = null, tint = Ios.Green, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(dom, color = Ios.Label, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    Icon(
                        Icons.Default.DeleteOutline,
                        contentDescription = null,
                        tint = Ios.Destructive,
                        modifier = Modifier
                            .size(20.dp)
                            .clickable {
                                CfEdgePassManager.removeCustomDomain(context, dom)
                                customDomains = CfEdgePassManager.getCustomDomains(context)
                            },
                    )
                }
            }
        }

        // Cloudflare Worker config & auto-deploy
        SettingsSectionHeader("ورکر سپر کلودفلر و آی‌پی تمیز")
        SettingsGroup {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Cloud, contentDescription = null, tint = Ios.Orange, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = workerUrl,
                    onValueChange = {
                        workerUrl = it
                        CfEdgePassManager.setWorkerUrl(context, it)
                    },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 14.sp),
                    cursorBrush = SolidColor(Ios.Orange),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (workerUrl.isEmpty()) Text("https://mlm-edge-pass.xxx.workers.dev", color = Ios.SecondaryLabel, fontSize = 13.sp)
                        inner()
                    },
                )
            }
            Box(Modifier.fillMaxWidth().padding(start = 48.dp).height(0.5.dp).background(Ios.Separator))
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Public, contentDescription = null, tint = Ios.Teal, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = cleanIp,
                    onValueChange = {
                        cleanIp = it
                        CfEdgePassManager.setCleanIp(context, it)
                    },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 14.sp),
                    cursorBrush = SolidColor(Ios.Teal),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (cleanIp.isEmpty()) Text("آی‌پی تمیز کلودفلر (اختیاری - مثلاً 104.16.x.x)", color = Ios.SecondaryLabel, fontSize = 13.sp)
                        inner()
                    },
                )
            }
            Box(Modifier.fillMaxWidth().padding(start = 48.dp).height(0.5.dp).background(Ios.Separator))
            SettingsActionRow(
                label = stringResource(R.string.cf_bypass_deploy_worker),
                icon = Icons.Default.Shield,
                tint = Color(0xFFE88B5A),
                busy = deploying,
                onClick = {
                    val acct = accounts.firstOrNull()
                    if (acct == null) {
                        Toast.makeText(context, "ابتدا در بخش ابر یک حساب کلودفلر اضافه کنید", Toast.LENGTH_LONG).show()
                        return@SettingsActionRow
                    }
                    deploying = true
                    scope.launch {
                        val (ok, res) = CfEdgePassManager.deployEdgePassWorker(context, acct)
                        deploying = false
                        if (ok) {
                            workerUrl = res
                            Toast.makeText(context, "ورکر سپر نصب شد: $res", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(context, "خطا در نصب ورکر: $res", Toast.LENGTH_LONG).show()
                        }
                    }
                },
            )
        }

        // Live probe
        SettingsSectionHeader(stringResource(R.string.cf_bypass_probe))
        SettingsGroup {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Speed, contentDescription = null, tint = Ios.Green, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = probeInput,
                    onValueChange = { probeInput = it },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 14.sp),
                    cursorBrush = SolidColor(Ios.Green),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(Ios.Green.copy(alpha = 0.25f))
                        .clickable(enabled = !probing) {
                            probing = true
                            scope.launch {
                                probeResult = CfEdgePassManager.probeDomain(context, probeInput)
                                probing = false
                            }
                        }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                ) {
                    Text(if (probing) "..." else "تست", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            probeResult?.let { r ->
                Box(Modifier.fillMaxWidth().padding(start = 48.dp).height(0.5.dp).background(Ios.Separator))
                SettingsRow(title = "مسیر مستقیم", value = "${r.directStatus} (${r.directMs}ms)", showChevron = false)
                Box(Modifier.fillMaxWidth().padding(start = 48.dp).height(0.5.dp).background(Ios.Separator))
                SettingsRow(title = "مسیر سپر CF", value = "${r.edgeStatus} (${r.edgeMs}ms)", showChevron = false)
            }
        }

        SettingsFooter("این بخش جایگزین وی‌پی‌ان برای مواقعی است که فقط چند سایت تحریمی یا هوش مصنوعی را لازم دارید و نمی‌خواهید ترافیک بانکی یا بازی‌های شما از سرور خارجی برود.")
        Spacer(Modifier.height(24.dp))
    }
}
