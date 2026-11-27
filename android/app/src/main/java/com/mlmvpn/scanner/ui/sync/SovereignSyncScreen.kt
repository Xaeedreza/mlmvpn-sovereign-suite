package com.mlmvpn.scanner.ui.sync

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.mlmvpn.scanner.R
import com.mlmvpn.scanner.engines.cfbypass.CfEdgePassManager
import com.mlmvpn.scanner.engines.sync.SovereignSyncManager
import com.mlmvpn.scanner.ui.settings.Ios
import com.mlmvpn.scanner.ui.settings.IosScreen
import com.mlmvpn.scanner.ui.settings.SettingsActionRow
import com.mlmvpn.scanner.ui.settings.SettingsFooter
import com.mlmvpn.scanner.ui.settings.SettingsGroup
import com.mlmvpn.scanner.ui.settings.SettingsSectionHeader
import kotlinx.coroutines.launch

@Composable
fun SovereignSyncScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var passphrase by remember { mutableStateOf("") }
    var bundleText by remember { mutableStateOf("") }
    var workerUrl by remember { mutableStateOf(CfEdgePassManager.getWorkerUrl(context)) }
    var kvKey by remember { mutableStateOf("sovereign-main") }
    var ghToken by remember { mutableStateOf("") }
    var gistId by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun copyText(label: String, text: String) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        cm?.setPrimaryClip(ClipData.newPlainText(label, text))
        Toast.makeText(context, "در کلیپ‌بورد کپی شد", Toast.LENGTH_SHORT).show()
    }

    IosScreen(
        title = stringResource(R.string.sovereign_sync_title),
        onBack = onBack,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF8E4B28), Color(0xFF4B2118))))
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Sync, contentDescription = null, tint = Color(0xFFFFD699), modifier = Modifier.size(34.dp))
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(
                        stringResource(R.string.sovereign_sync_title),
                        color = Color.White,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        stringResource(R.string.sovereign_sync_subtitle),
                        color = Color.White.copy(alpha = 0.80f),
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                    )
                }
            }
        }

        SettingsSectionHeader(stringResource(R.string.sovereign_sync_passphrase))
        SettingsGroup {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Key, contentDescription = null, tint = Color(0xFFE8A85A), modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 15.sp),
                    cursorBrush = SolidColor(Color(0xFFE8A85A)),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (passphrase.isEmpty()) Text("رمز حداقل ۶ کاراکتر (مشترک در همه دستگاه‌ها)", color = Ios.SecondaryLabel, fontSize = 13.sp)
                        inner()
                    },
                )
            }
        }

        SettingsSectionHeader("بسته رمزنگاری‌شده آفلاین (mlmsync://v1)")
        SettingsGroup {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.QrCode2, contentDescription = null, tint = Ios.Teal, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = bundleText,
                    onValueChange = { bundleText = it },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 13.sp),
                    cursorBrush = SolidColor(Ios.Teal),
                    maxLines = 4,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (bundleText.isEmpty()) Text("کد mlmsync://v1/... را اینجا پیست یا تولید کنید", color = Ios.SecondaryLabel, fontSize = 12.sp)
                        inner()
                    },
                )
            }
            Box(Modifier.fillMaxWidth().padding(start = 48.dp).height(0.5.dp).background(Ios.Separator))
            SettingsActionRow(
                label = stringResource(R.string.sovereign_sync_export),
                icon = Icons.Default.ContentCopy,
                tint = Color(0xFFE8A85A),
                onClick = {
                    if (passphrase.length < 6) {
                        Toast.makeText(context, "رمز مشترک باید حداقل ۶ کاراکتر باشد", Toast.LENGTH_SHORT).show()
                        return@SettingsActionRow
                    }
                    val snap = SovereignSyncManager.exportSnapshot(context)
                    val code = SovereignSyncManager.encryptBundle(snap, passphrase)
                    bundleText = code
                    copyText("mlmsync", code)
                },
            )
            Box(Modifier.fillMaxWidth().padding(start = 48.dp).height(0.5.dp).background(Ios.Separator))
            SettingsActionRow(
                label = stringResource(R.string.sovereign_sync_import),
                icon = Icons.Default.CloudDownload,
                tint = Ios.Green,
                onClick = {
                    if (passphrase.length < 6 || bundleText.isBlank()) {
                        Toast.makeText(context, "رمز مشترک و کد mlmsync را وارد کنید", Toast.LENGTH_SHORT).show()
                        return@SettingsActionRow
                    }
                    try {
                        val snap = SovereignSyncManager.decryptBundle(bundleText, passphrase)
                        val stats = SovereignSyncManager.applySnapshot(context, snap)
                        Toast.makeText(
                            context,
                            "به‌روز شد: +${stats["accounts"]} اکانت، +${stats["domains"]} دامنه",
                            Toast.LENGTH_LONG,
                        ).show()
                    } catch (e: Exception) {
                        Toast.makeText(context, "خطا در رمزگشایی: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                },
            )
        }

        SettingsSectionHeader("همگام‌سازی ابری (Cloudflare Worker KV)")
        SettingsGroup {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = workerUrl,
                    onValueChange = { workerUrl = it },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 14.sp),
                    cursorBrush = SolidColor(Ios.Orange),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (workerUrl.isEmpty()) Text("آدرس ورکر (https://mlm-edge-pass.xxx.workers.dev)", color = Ios.SecondaryLabel, fontSize = 12.sp)
                        inner()
                    },
                )
            }
            Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(Ios.Separator))
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = kvKey,
                    onValueChange = { kvKey = it },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 14.sp),
                    cursorBrush = SolidColor(Ios.Orange),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (kvKey.isEmpty()) Text("کلید پروفایل (مثلاً sovereign-main)", color = Ios.SecondaryLabel, fontSize = 12.sp)
                        inner()
                    },
                )
            }
            Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(Ios.Separator))
            SettingsActionRow(
                label = stringResource(R.string.sovereign_sync_push_cf),
                icon = Icons.Default.CloudUpload,
                tint = Ios.Orange,
                busy = busy,
                onClick = {
                    if (passphrase.length < 6 || workerUrl.isBlank()) {
                        Toast.makeText(context, "آدرس ورکر و رمز را وارد کنید", Toast.LENGTH_SHORT).show()
                        return@SettingsActionRow
                    }
                    busy = true
                    scope.launch {
                        val (_, msg) = SovereignSyncManager.pushToCfKv(context, workerUrl, kvKey, passphrase)
                        busy = false
                        Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                    }
                },
            )
            Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(Ios.Separator))
            SettingsActionRow(
                label = stringResource(R.string.sovereign_sync_pull_cf),
                icon = Icons.Default.CloudDownload,
                tint = Ios.Green,
                busy = busy,
                onClick = {
                    if (passphrase.length < 6 || workerUrl.isBlank()) {
                        Toast.makeText(context, "آدرس ورکر و رمز را وارد کنید", Toast.LENGTH_SHORT).show()
                        return@SettingsActionRow
                    }
                    busy = true
                    scope.launch {
                        val (_, msg) = SovereignSyncManager.pullFromCfKv(context, workerUrl, kvKey, passphrase)
                        busy = false
                        Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                    }
                },
            )
        }

        SettingsSectionHeader("همگام‌سازی ابری (GitHub Secret Gist)")
        SettingsGroup {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = ghToken,
                    onValueChange = { ghToken = it },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 14.sp),
                    cursorBrush = SolidColor(Ios.Teal),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (ghToken.isEmpty()) Text("GitHub PAT (دسترسی gist)", color = Ios.SecondaryLabel, fontSize = 12.sp)
                        inner()
                    },
                )
            }
            Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(Ios.Separator))
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = gistId,
                    onValueChange = { gistId = it },
                    textStyle = TextStyle(color = Ios.Label, fontSize = 14.sp),
                    cursorBrush = SolidColor(Ios.Teal),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (gistId.isEmpty()) Text("شناسه Gist برای دریافت", color = Ios.SecondaryLabel, fontSize = 12.sp)
                        inner()
                    },
                )
            }
            Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(Ios.Separator))
            SettingsActionRow(
                label = stringResource(R.string.sovereign_sync_push_gist),
                icon = Icons.Default.CloudUpload,
                tint = Ios.Teal,
                busy = busy,
                onClick = {
                    if (passphrase.length < 6 || ghToken.isBlank()) {
                        Toast.makeText(context, "توکن گیت‌هاب و رمز را وارد کنید", Toast.LENGTH_SHORT).show()
                        return@SettingsActionRow
                    }
                    busy = true
                    scope.launch {
                        val (ok, res) = SovereignSyncManager.pushToGist(context, ghToken, passphrase)
                        busy = false
                        if (ok) {
                            gistId = res
                            copyText("Gist ID", res)
                            Toast.makeText(context, "Gist ذخیره شد: $res", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(context, res, Toast.LENGTH_LONG).show()
                        }
                    }
                },
            )
            Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(Ios.Separator))
            SettingsActionRow(
                label = stringResource(R.string.sovereign_sync_pull_gist),
                icon = Icons.Default.CloudDownload,
                tint = Ios.Green,
                busy = busy,
                onClick = {
                    if (passphrase.length < 6 || gistId.isBlank()) {
                        Toast.makeText(context, "شناسه Gist و رمز را وارد کنید", Toast.LENGTH_SHORT).show()
                        return@SettingsActionRow
                    }
                    busy = true
                    scope.launch {
                        val (_, msg) = SovereignSyncManager.pullFromGist(context, ghToken, gistId, passphrase)
                        busy = false
                        Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                    }
                },
            )
        }

        SettingsFooter("همه بسته‌ها با PBKDF2-HMAC-SHA256 (صد هزار تکرار) و رمزنگاری AES-256-GCM قفل می‌شوند؛ یعنی حتی در فضای ابری هم بدون رمز شما قابل خواندن نیستند.")
        Spacer(Modifier.height(24.dp))
    }
}
