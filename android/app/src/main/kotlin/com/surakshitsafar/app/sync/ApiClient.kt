package com.surakshitsafar.app.sync

import com.surakshitsafar.app.BuildConfig
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Minimal JSON-over-HTTPS client (no Retrofit: fewer deps, smaller APK for budget phones).
 * Endpoint contract: README_ANDROID.md, "Server API contract".
 */
class ApiClient(
    private val baseUrl: String = BuildConfig.API_BASE_URL,
    private val token: () -> String,
    private val installId: String,
) {
    class HttpException(val code: Int, body: String) : IOException("HTTP $code: ${body.take(200)}")

    @Throws(IOException::class)
    fun post(path: String, body: JSONObject): JSONObject {
        val conn = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 30_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-Install-Id", installId)
            token().takeIf { it.isNotBlank() }?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (code !in 200..299) throw HttpException(code, text)
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }
}
