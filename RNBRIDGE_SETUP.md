# RNBridge.gd — Godot AutoLoad for React Native Messaging

## 1. Create the Script

Save this file in your Godot project as `res://RNBridge.gd`:

```gdscript
extends Node

## Emitted whenever a message is received from React Native.
## Connect to this signal in any scene to react to JS events.
signal message_received(data: String)

## Called by the C++ Nitro Module via GDExtension variant_call.
## The method name MUST match "on_react_native_message".
##
## Example usage from React Native:
##   sendMessage("hello from JS")
##
## Then in any GDScript:
##   RNBridge.message_received.connect(_on_message)
##   func _on_message(data: String) -> void:
##       print("Got:", data)
func on_react_native_message(payload: String) -> void:
    print("[Godot] Received from React Native: ", payload)
    emit_signal("message_received", payload)
```

## 2. Register as AutoLoad (Singleton)

In the Godot Editor:
1. Open **Project → Project Settings → AutoLoad** tab
2. Click the folder icon and select `res://RNBridge.gd`
3. Set **Node Name** to `RNBridge`
4. Enable the **Singleton** toggle
5. Click **Add**

This creates a global node at `/root/RNBridge`, which is what the C++ call resolves to:

```cpp
variant_call(root_var, "get_node", {"/root/RNBridge"}, ...)
```

## 3. Re-export the .pck

After adding the AutoLoad:
1. Open **Project → Export**
2. Export as `.pck` (not an executable)
3. Place the `.pck` in `example/assets/game.pck`

The `usePckExtract` hook in `App.tsx` will copy it to `documentDirectory` at runtime so Godot's `FileAccess` can read it.

## 4. Test the Pipeline

In a scene script, connect to the signal:

```gdscript
func _ready() -> void:
    RNBridge.message_received.connect(_on_rn_message)

func _on_rn_message(data: String) -> void:
    $Label.text = "JS says: " + data
```

From React Native:

```tsx
const { sendMessage } = useGodotEngine(pckPath);
<Button title="Ping Godot" onPress={() => sendMessage('hello!')} />
```

Expected logcat / Xcode console output:

```
[Godot] Received from React Native: hello!
[NitroGodot] sendMessage: dispatched 'hello!' → RNBridge.on_react_native_message()
```
