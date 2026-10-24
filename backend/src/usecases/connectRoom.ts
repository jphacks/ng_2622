import type { RoomRepository } from "../repositories/roomRepository";

export const connectRoom = (
  repository: RoomRepository,
  roomId: string,
  request: Request,
) => repository.connect(roomId, request);
