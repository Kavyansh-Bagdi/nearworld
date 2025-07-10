import React, { useEffect, useRef } from "react";
import Phaser from "phaser";
import socket from "../lib/socket";
import { Player } from "../lib/player";

const PhaserGame: React.FC = () => {
    const gameContainerRef = useRef<HTMLDivElement>(null);
    const phaserGameRef = useRef<Phaser.Game | null>(null);

    useEffect(() => {
        let localPlayer: Phaser.Physics.Arcade.Sprite | null = null;
        let cursors: Phaser.Types.Input.Keyboard.CursorKeys;
        let lastDirection: "up" | "down" | "left" | "right" = "down";
        let lastSentX = 0;
        let lastSentY = 0;

        const remotePlayers = new Map<string, Player>();

        class MainScene extends Phaser.Scene {
            private remoteGroup!: Phaser.Physics.Arcade.Group;

            constructor() {
                super("MainScene");
            }

            preload() {
                this.load.tilemapTiledJSON("map", "/assets/map");
                this.load.image("tiles", "/assets/Outside.png");
                this.load.spritesheet("player", "/assets/1.png", {
                    frameWidth: 32,
                    frameHeight: 48,
                });
            }

            create() {
                const map = this.make.tilemap({ key: "map" });
                const tileset = map.addTilesetImage("allinone", "tiles");
                const water = map.createLayer('water', tileset!, 0, 0)?.setDepth(0);
                const water_top = map.createLayer('water_top', tileset!, 0, 0)?.setDepth(1);
                const ground = map.createLayer('ground', tileset!, 0, 0)?.setDepth(2);
                const grass = map.createLayer('grass', tileset!, 0, 0)?.setDepth(3);
                const rocks_trees = map.createLayer('rocks_&_trees', tileset!, 0, 0)?.setDepth(4);
                const buliding = map.createLayer('building', tileset!, 0, 0)?.setDepth(5);
                const buliding_top = map.createLayer('building_top', tileset!, 0, 0)?.setDepth(6);
                const tree_top = map.createLayer('tree_top', tileset!, 0, 0)?.setDepth(7);


                Player.registerAnimations(this);

                cursors = this.input.keyboard!.createCursorKeys();

                localPlayer = this.physics.add.sprite(500, 500, "player").setOrigin(0, 0).setDepth(3);
                localPlayer.anims.play("idle-down", true);
                lastSentX = localPlayer.x;
                lastSentY = localPlayer.y;

                water!.setCollisionByExclusion([-1]);
                buliding!.setCollisionByExclusion([-1]);
                rocks_trees!.setCollisionByExclusion([-1]);

                this.physics.add.collider(localPlayer, water!);
                this.physics.add.collider(localPlayer, buliding!);
                this.physics.add.collider(localPlayer, rocks_trees!);

                this.remoteGroup = this.physics.add.group();
                this.physics.add.collider(localPlayer, this.remoteGroup);

                this.cameras.main.startFollow(localPlayer);
                this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
                this.cameras.main.setZoom(3);
                socket.on("players-update", (players: any[]) => {
                    const currentIds = new Set<string>();

                    players.forEach(({ socketId, coordinate }: any) => {
                        const { x, y } = coordinate;
                        if (socketId === socket.id) return;

                        currentIds.add(socketId);

                        if (!remotePlayers.has(socketId)) {
                            const remote = new Player({
                                scene: this,
                                x,
                                y,
                                id: socketId,
                                isLocal: false,
                            });
                            remotePlayers.set(socketId, remote);
                            this.remoteGroup.add(remote.sprite);
                        } else {
                            const remote = remotePlayers.get(socketId)!;
                            remote.setPosition(x, y);
                        }
                    });

                    // Clean up disconnected players
                    for (const [id, player] of remotePlayers.entries()) {
                        if (!currentIds.has(id)) {
                            player.destroy();
                            remotePlayers.delete(id);
                        }
                    }
                });
            }

            update() {
                const dt = this.game.loop.delta / 1000;

                remotePlayers.forEach((player) => player.update(dt));

                if (!localPlayer || !cursors) return;

                const speed = 100;
                let moving = false;
                localPlayer.setVelocity(0);

                if (cursors.left.isDown) {
                    localPlayer.setVelocityX(-speed);
                    localPlayer.anims.play("walk-left", true);
                    lastDirection = "left";
                    moving = true;
                } else if (cursors.right.isDown) {
                    localPlayer.setVelocityX(speed);
                    localPlayer.anims.play("walk-right", true);
                    lastDirection = "right";
                    moving = true;
                } else if (cursors.up.isDown) {
                    localPlayer.setVelocityY(-speed);
                    localPlayer.anims.play("walk-up", true);
                    lastDirection = "up";
                    moving = true;
                } else if (cursors.down.isDown) {
                    localPlayer.setVelocityY(speed);
                    localPlayer.anims.play("walk-down", true);
                    lastDirection = "down";
                    moving = true;
                }

                if (!moving) {
                    localPlayer.anims.play(`idle-${lastDirection}`, true);
                }

                if (localPlayer.x !== lastSentX || localPlayer.y !== lastSentY) {
                    socket.emit("update-position", {
                        newX: localPlayer.x,
                        newY: localPlayer.y,
                    });
                    lastSentX = localPlayer.x;
                    lastSentY = localPlayer.y;
                }
            }
        }

        if (gameContainerRef.current && !phaserGameRef.current) {
            phaserGameRef.current = new Phaser.Game({
                type: Phaser.AUTO,
                width: 4 * 10 * 32,
                height: 3 * 10 * 32,
                parent: gameContainerRef.current,
                scene: MainScene,
                backgroundColor: "#ffffff",
                physics: {
                    default: "arcade",
                    arcade: {
                        gravity: { x: 0, y: 0 },
                        debug: false,
                    },
                },
            });
        }

        return () => {
            phaserGameRef.current?.destroy(true);
            phaserGameRef.current = null;
            socket.disconnect();
            socket.removeAllListeners();
        };
    }, []);

    return <div ref={gameContainerRef} />;
};

export default PhaserGame;
