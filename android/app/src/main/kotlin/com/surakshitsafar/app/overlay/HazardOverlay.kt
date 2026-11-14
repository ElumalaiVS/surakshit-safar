package com.surakshitsafar.app.overlay

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import com.surakshitsafar.core.Cue
import com.surakshitsafar.core.Severity
import kotlin.math.abs
import kotlin.math.min

/**
 * Companion-mode UI drawn over other apps (Rapido, Uber, Ola, Swiggy, Maps).
 *
 * Calm by design:
 *  - Nothing on screen between alerts. The bubble appears only for a cue, fades in,
 *    stays while the hazard is relevant (4-12 s) and fades away. The persistent
 *    notification is the only "I'm running" signal.
 *  - Only critical cues pulse the bubble and flash the screen edges; warnings and
 *    speed nudges are a still bubble.
 *  - Never takes focus, never requires a tap; touches pass through to the app below.
 * All methods may be called from any thread; work is posted to the main thread.
 */
class HazardOverlay(private val context: Context) {

    private val main = Handler(Looper.getMainLooper())
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val density = context.resources.displayMetrics.density

    private var bubble: BubbleView? = null
    private var bubbleX = (12 * density).toInt()
    private var bubbleY = (180 * density).toInt()
    private var flash: EdgeFlashView? = null
    private val dismissBubble = Runnable { fadeOutBubble() }

    fun canDraw(): Boolean = Settings.canDrawOverlays(context)

    fun showCue(cue: Cue, shortLabel: String) = main.post {
        if (!canDraw()) return@post
        val v = ensureBubble() ?: return@post
        v.showCue(cue, shortLabel)
        main.removeCallbacks(dismissBubble)
        val holdMs = (cue.timeToHazardS.takeIf { it.isFinite() }?.times(1000)?.toLong() ?: 5000L)
            .coerceIn(4000L, 12000L)
        main.postDelayed(dismissBubble, holdMs)
        if (cue.flash) flashEdges()
    }

    fun hide() = main.post {
        main.removeCallbacksAndMessages(null)
        bubble?.let { runCatching { wm.removeView(it) } }
        flash?.let { runCatching { wm.removeView(it) } }
        bubble = null
        flash = null
    }

    // --------------------------------------------------------------- bubble

    @SuppressLint("ClickableViewAccessibility")
    private fun ensureBubble(): BubbleView? {
        bubble?.let { return it }
        val size = (76 * density).toInt()
        val params = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = bubbleX
            y = bubbleY
        }
        val v = BubbleView(context)
        v.alpha = 0f
        // Drag to reposition (when stopped); position is remembered for the next alert.
        var startX = 0; var startY = 0; var touchX = 0f; var touchY = 0f
        v.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { startX = params.x; startY = params.y; touchX = e.rawX; touchY = e.rawY; true }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX - (e.rawX - touchX).toInt()     // gravity END: x grows leftwards
                    params.y = startY + (e.rawY - touchY).toInt()
                    bubbleX = params.x; bubbleY = params.y
                    runCatching { wm.updateViewLayout(v, params) }
                    true
                }
                else -> abs(e.rawX - touchX) > 10 || abs(e.rawY - touchY) > 10
            }
        }
        return if (runCatching { wm.addView(v, params) }.isSuccess) {
            bubble = v
            v.animate().alpha(1f).setDuration(180).start()
            v
        } else null
    }

    private fun fadeOutBubble() {
        val v = bubble ?: return
        v.animate().alpha(0f).setDuration(300).withEndAction {
            if (bubble === v) {
                runCatching { wm.removeView(v) }
                bubble = null
            }
        }.start()
    }

    // ---------------------------------------------------------------- flash

    private fun flashEdges() {
        if (flash != null) return               // one flash at a time; never stack
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            // Android 12+ blocks touches passing through overlays above 0.8 opacity;
            // staying at 0.8 keeps the gig app underneath fully usable during the flash.
            alpha = 0.8f
        }
        val v = EdgeFlashView(context, density)
        if (runCatching { wm.addView(v, params) }.isFailure) return
        flash = v
        v.pulse { main.post { runCatching { wm.removeView(v) }; if (flash === v) flash = null } }
    }

    // ---------------------------------------------------------------- views

    private class BubbleView(ctx: Context) : View(ctx) {
        private val d = ctx.resources.displayMetrics.density
        private val disc = Paint(Paint.ANTI_ALIAS_FLAG)
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * d }
        private val big = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD; textSize = 20 * d
        }
        private val small = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textAlign = Paint.Align.CENTER; textSize = 10 * d
        }
        private var color = 0xFF111111.toInt()
        private var line1 = ""
        private var line2 = ""
        private var scale = 1f
        private var pulse: ValueAnimator? = null

        fun showCue(cue: Cue, label: String) {
            color = cue.colorArgb.toInt()
            val speed = cue.speedKmh
            if (speed != null) {
                line1 = "$speed"
                line2 = "km/h"
            } else {
                line1 = if (cue.distanceM > 0) "${cue.distanceM}m" else "!"
                line2 = label.take(12)
            }
            pulse?.cancel()
            scale = 1f
            if (cue.level == Severity.CRITICAL) {
                pulse = ValueAnimator.ofFloat(1f, 1.1f, 1f).apply {
                    duration = 450; repeatCount = 3
                    addUpdateListener { scale = it.animatedValue as Float; invalidate() }
                    start()
                }
            }
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            val r = min(cx, cy) * 0.86f * scale
            disc.color = color
            ring.color = Color.WHITE
            canvas.drawCircle(cx, cy, r, disc)
            canvas.drawCircle(cx, cy, r, ring)
            canvas.drawText(line1, cx, cy + big.textSize * 0.3f - (if (line2.isEmpty()) 0f else 4 * d), big)
            if (line2.isNotEmpty()) canvas.drawText(line2, cx, cy + big.textSize * 0.3f + 12 * d, small)
        }
    }

    private class EdgeFlashView(ctx: Context, private val d: Float) : View(ctx) {
        private val paint = Paint().apply { style = Paint.Style.STROKE; color = 0xFFFF3B30.toInt() }
        private var alphaNow = 0f

        fun pulse(done: () -> Unit) {
            ValueAnimator.ofFloat(0f, 1f, 0f, 1f, 0f).apply {
                duration = 1000                  // two soft pulses, then gone
                addUpdateListener { alphaNow = it.animatedValue as Float; invalidate() }
                addListener(object : AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: Animator) { done() }
                })
                start()
            }
        }

        override fun onDraw(canvas: Canvas) {
            paint.alpha = (alphaNow * 255).toInt()
            paint.strokeWidth = 14 * d
            val inset = paint.strokeWidth / 2
            canvas.drawRect(inset, inset, width - inset, height - inset, paint)
        }
    }
}
