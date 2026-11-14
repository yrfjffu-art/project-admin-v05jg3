import JSZip from 'jszip';
import { androidStringResource, kotlinString, packageNameError, xmlEscape } from '../lib/sanitize.js';

export const TEMPLATE_TOOLCHAIN = { agp: '8.7.3', kotlin: '2.0.21', jdk: '17', compileSdk: '35', buildTools: '35.0.0', gradle: '8.11.1', minSdk: 24 };

/**
 * Generate a minimal WebView Android project (Kotlin, no external dependencies).
 * Inputs MUST already be validated; this function still re-checks the package name and
 * escapes every user-controlled value for the file type it lands in.
 */
export async function generateWebViewProject({ appName, packageName, url, icon }) {
  const pkgErr = packageNameError(packageName);
  if (pkgErr) throw new Error(pkgErr);
  const href = new URL(url).href; // normalised, no raw user formatting reaches the source
  const cleartext = href.startsWith('http:');
  const T = TEMPLATE_TOOLCHAIN;
  const zip = new JSZip();
  const root = zip.folder('web2apk');

  root.file('settings.gradle.kts', `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "Web2ApkApp"
include(":app")
`);

  root.file('build.gradle.kts', `plugins {
    id("com.android.application") version "${T.agp}" apply false
    id("org.jetbrains.kotlin.android") version "${T.kotlin}" apply false
}
`);

  root.file('gradle.properties', `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`);

  root.file('app/build.gradle.kts', `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "${packageName}"
    compileSdk = ${T.compileSdk}

    defaultConfig {
        applicationId = "${packageName}"
        minSdk = ${T.minSdk}
        targetSdk = ${T.compileSdk}
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
`);

  const iconAttr = icon ? '@mipmap/ic_launcher' : '@android:drawable/sym_def_app_icon';
  root.file('app/src/main/AndroidManifest.xml', `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <application
        android:allowBackup="false"
        android:icon="${xmlEscape(iconAttr)}"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:usesCleartextTraffic="${cleartext ? 'true' : 'false'}"
        android:theme="@android:style/Theme.Material.Light.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`);

  root.file('app/src/main/res/values/strings.xml', `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name" formatted="false">${androidStringResource(appName)}</string>
</resources>
`);

  if (icon) root.file(`app/src/main/res/mipmap-xxxhdpi/ic_launcher.${icon.ext}`, icon.data);

  const pkgPath = packageName.replace(/\./g, '/');
  root.file(`app/src/main/java/${pkgPath}/MainActivity.kt`, `package ${packageName}

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.text.TextUtils
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar

class MainActivity : Activity() {
    companion object {
        private const val START_URL = ${kotlinString(href)}
        private const val APP_NAME = ${kotlinString(appName)}
    }

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        webView = WebView(this)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 8))
        setContentView(root)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme?.lowercase()
                if (scheme == "http" || scheme == "https") return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (e: ActivityNotFoundException) {
                    // No app can handle this link; ignore it.
                }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String?) {
                progress.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    val html = "<html><body style='font-family:sans-serif;text-align:center;padding:30% 24px'>" +
                        "<h3>" + TextUtils.htmlEncode(APP_NAME) + "</h3><p>You appear to be offline.</p>" +
                        "<p><a href='" + TextUtils.htmlEncode(START_URL) + "'>Try again</a></p></body></html>"
                    view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
            }
        }

        if (savedInstanceState != null) webView.restoreState(savedInstanceState) else webView.loadUrl(START_URL)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
`);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
