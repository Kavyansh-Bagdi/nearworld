import Phaser from "phaser";

export interface PlayerConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  id: string;
  key?: string;
  isLocal?: boolean;
}

export class Player {
  public id: string;
  public sprite: Phaser.Physics.Arcade.Sprite;
  public isLocal: boolean;

  private scene: Phaser.Scene;
  private targetX: number;
  private targetY: number;
  private lastDirection: "up" | "down" | "left" | "right" = "down";

  constructor({
    scene,
    x,
    y,
    id,
    key = "player",
    isLocal = false,
  }: PlayerConfig) {
    this.id = id;
    this.isLocal = isLocal;
    this.scene = scene;

    this.sprite = scene.physics.add.sprite(x, y, key);
    this.sprite.setOrigin(0, 0).setScale(1);

    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Set new target position (used for remote players).
   */
  setPosition(x: number, y: number) {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Update player every frame (only for remote players).
   */
  update(dt: number) {
    if (this.isLocal) return;

    const dx = this.targetX - this.sprite.x;
    const dy = this.targetY - this.sprite.y;
    const dist = Math.hypot(dx, dy);

    const threshold = 0.5;
    const speed = 8;

    if (dist < threshold) {
      this.sprite.setPosition(this.targetX, this.targetY);
      this.playAnimation(`idle-${this.lastDirection}`);
      return;
    }

    // Determine animation direction
    if (Math.abs(dx) > Math.abs(dy)) {
      this.lastDirection = dx > 0 ? "right" : "left";
    } else {
      this.lastDirection = dy > 0 ? "down" : "up";
    }

    // Smoothly move toward target
    this.sprite.x += dx * Math.min(dt * speed, 1);
    this.sprite.y += dy * Math.min(dt * speed, 1);

    this.playAnimation(`walk-${this.lastDirection}`);
  }

  /**
   * Play an animation only if not already playing.
   */
  private playAnimation(key: string) {
    if (this.sprite.anims.currentAnim?.key !== key) {
      this.sprite.anims.play(key, true);
    }
  }

  /**
   * Stop any animation on the player.
   */
  stopAnimation() {
    this.sprite.anims.stop();
  }

  /**
   * Destroy sprite on player disconnect.
   */
  destroy() {
    this.sprite.destroy();
  }

  /**
   * Register animations (once globally).
   */
  private static animationsRegistered = false;

  static registerAnimations(scene: Phaser.Scene) {
    if (Player.animationsRegistered) return;
    Player.animationsRegistered = true;

    const anims = [
      { key: "walk-down", frames: [0, 1, 2, 3] },
      { key: "walk-left", frames: [4, 5, 6, 7] },
      { key: "walk-right", frames: [8, 9, 10, 11] },
      { key: "walk-up", frames: [12, 13, 14, 15] },
    ];

    const idles = [
      { key: "idle-down", frame: 0 },
      { key: "idle-left", frame: 4 },
      { key: "idle-right", frame: 8 },
      { key: "idle-up", frame: 12 },
    ];

    anims.forEach(({ key, frames }) => {
      if (!scene.anims.exists(key)) {
        scene.anims.create({
          key,
          frames: scene.anims.generateFrameNumbers("player", { frames }),
          frameRate: 10,
          repeat: -1,
        });
      }
    });

    idles.forEach(({ key, frame }) => {
      if (!scene.anims.exists(key)) {
        scene.anims.create({
          key,
          frames: [{ key: "player", frame }],
          frameRate: 1,
          repeat: -1,
        });
      }
    });
  }
}
