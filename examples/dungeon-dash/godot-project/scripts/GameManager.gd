extends Node

## GameManager — NitroSwarm wave spawner and score tracker.
##
## Handles:
##   - Continuous wave spawning (enemies regenerate when wave is cleared)
##   - Score/combo tracking (kills → score, rapid kills → combo multiplier)
##   - 60Hz state sync push via RNBridge.sync_full_state()
##
## Set as AutoLoad in project.godot so it persists across scene changes.
## Add to [autoload] section: GameManager="*res://scripts/GameManager.gd"

# ─── Wave / Spawner Config ────────────────────────────────────────────────────

## Path to the enemy PackedScene (simple CharacterBody3D with Enemy.gd)
@export var enemy_scene_path: String = "res://scenes/Enemy.tscn"

## Spawn points in the arena (overridden per-scene; default: ring around origin)
@export var spawn_radius: float = 8.0
@export var enemies_per_wave: int = 5

# ─── Score State ─────────────────────────────────────────────────────────────

var score: int = 0
var combo: int = 0
var wave_number: int = 1

# Internal
var _combo_timer: float = 0.0        # Seconds since last kill; resets combo
const COMBO_WINDOW: float = 3.0      # Kill within 3s of previous → combo grows
var _wave_clear_timer: float = 0.0   # Delay before spawning next wave
var _spawning: bool = false
var _enemy_scene: PackedScene = null

# ─── Ready ────────────────────────────────────────────────────────────────────

func _ready() -> void:
	# Pre-load the enemy scene so first spawn is instant
	if ResourceLoader.exists(enemy_scene_path):
		_enemy_scene = load(enemy_scene_path)
	# Small initial delay before the first wave spawns
	_wave_clear_timer = 2.0
	_spawning = true

# ─── Process ─────────────────────────────────────────────────────────────────

func _process(delta: float) -> void:
	# ── Combo decay ──
	if combo > 0:
		_combo_timer -= delta
		if _combo_timer <= 0.0:
			combo = 0

	# ── Wave clear check + respawn ──
	if _spawning:
		_wave_clear_timer -= delta
		if _wave_clear_timer <= 0.0:
			_spawning = false
			_spawn_wave()

	var alive = get_tree().get_nodes_in_group("enemies").size()
	if alive == 0 and not _spawning:
		# Wave cleared — increment wave, schedule next spawn
		wave_number += 1
		enemies_per_wave = min(enemies_per_wave + 2, 20)  # Scale up, cap at 20
		_wave_clear_timer = 3.0
		_spawning = true
		RNBridge.send_to_react_native(JSON.stringify({
			"type": "WAVE_CLEAR",
			"wave": wave_number - 1,
			"nextWave": wave_number
		}))

# ─── Enemy Kill (called by Enemy.gd via RNBridge.on_enemy_killed) ─────────────

func on_enemy_killed() -> void:
	# Score: base 100 × combo multiplier
	var multiplier: int = max(1, combo)
	score += 100 * multiplier

	# Extend combo
	combo += 1
	_combo_timer = COMBO_WINDOW

# ─── Wave Spawning ────────────────────────────────────────────────────────────

func _spawn_wave() -> void:
	if not _enemy_scene:
		if ResourceLoader.exists(enemy_scene_path):
			_enemy_scene = load(enemy_scene_path)
		else:
			push_warning("[GameManager] Enemy scene not found: " + enemy_scene_path)
			return

	var parent: Node = get_tree().current_scene
	if not parent:
		return

	for i in range(enemies_per_wave):
		var angle := (TAU / enemies_per_wave) * i
		var spawn_pos := Vector3(
			cos(angle) * spawn_radius,
			0.5,
			sin(angle) * spawn_radius
		)

		var enemy: Node3D = _enemy_scene.instantiate()
		enemy.global_position = spawn_pos
		parent.add_child(enemy)

	RNBridge.send_to_react_native(JSON.stringify({
		"type": "WAVE_STARTED",
		"wave": wave_number,
		"enemyCount": enemies_per_wave
	}))
