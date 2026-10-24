export const createRoomRepository = (rooms: CloudflareBindings["ROOM"]) => ({
  create: (roomId: string) => rooms.getByName(roomId).create(roomId),
  findSummary: (roomId: string) => rooms.getByName(roomId).summary(),
  connect: (roomId: string, request: Request) =>
    rooms.getByName(roomId).fetch(request),
});

export type RoomRepository = ReturnType<typeof createRoomRepository>;
