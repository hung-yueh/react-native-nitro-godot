package com.example.godotsandbox;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.SurfaceView;
import android.view.SurfaceHolder;
import android.view.ViewGroup;
import android.widget.FrameLayout;

public class MainActivity extends Activity implements SurfaceHolder.Callback {
    private SurfaceView surfaceView;

    static {
        System.loadLibrary("c++_shared");
        System.loadLibrary("godot");
        System.loadLibrary("sandbox");
    }

    private native void initGodot(Object surface);
    private native void stepGodot();
    
    private boolean isRunning = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        FrameLayout layout = new FrameLayout(this);
        surfaceView = new SurfaceView(this);
        surfaceView.getHolder().addCallback(this);
        layout.addView(surfaceView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 
                ViewGroup.LayoutParams.MATCH_PARENT));
        
        setContentView(layout);
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        Log.i("GodotSandbox", "Surface created, initializing Godot...");
        initGodot(holder.getSurface());
        
        isRunning = true;
        new Thread(() -> {
            while (isRunning) {
                stepGodot();
                try { Thread.sleep(16); } catch (Exception e) {}
            }
        }).start();
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        isRunning = false;
    }
}
