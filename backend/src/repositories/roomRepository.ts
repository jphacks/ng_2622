import type { Grade } from "../domain/round";

export const createRoomRepository = (rooms: CloudflareBindings["ROOM"]) => ({
  create: (roomId: string) => rooms.getByName(roomId).create(roomId),
  findSummary: (roomId: string) => rooms.getByName(roomId).summary(),
  connect: (roomId: string, request: Request) =>
    rooms.getByName(roomId).fetch(request),
  beginGrading: (
    roomId: string,
    input: { playerId: string; token: string; round: number },
  ) => rooms.getByName(roomId).beginGrading(input),
  recordGrade: (
    roomId: string,
    input: { playerId: string; round: number; grade: Grade },
  ) => rooms.getByName(roomId).recordGrade(input),
  /** その部屋で AI が作った場面の配置。無ければ null */
  findSceneLayout: (roomId: string, sceneId: string) =>
    rooms.getByName(roomId).sceneLayout(sceneId),
});

export type RoomRepository = ReturnType<typeof createRoomRepository>;
