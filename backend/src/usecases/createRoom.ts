import type { RoomRepository } from "../repositories/roomRepository";

const MAX_ATTEMPTS = 20;

const randomRoomId = () =>
  String(Math.floor(Math.random() * 10_000)).padStart(4, "0");

/** 空いているコードで部屋を作る。見つからなければ null */
export const createRoom = async (repository: RoomRepository) => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const roomId = randomRoomId();
    const host = await repository.create(roomId);
    if (host) return { roomId, ...host };
  }
  return null;
};
