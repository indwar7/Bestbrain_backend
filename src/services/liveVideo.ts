import { RoomServiceClient } from "livekit-server-sdk";
import { env } from "../config/env";

// The client-facing LiveKit URL is a WebSocket URL (wss://...), but the
// server-side RoomServiceClient talks to the HTTP API. Convert the scheme.
function httpApiUrl(): string {
  return env.livekitUrl.replace(/^ws(s?):\/\//, "http$1://");
}

let client: RoomServiceClient | null = null;

function roomService(): RoomServiceClient | null {
  if (!env.livekitConfigured) return null;
  if (!client) {
    client = new RoomServiceClient(
      httpApiUrl(),
      env.livekitApiKey,
      env.livekitApiSecret
    );
  }
  return client;
}

// Delete (tear down) a LiveKit room. This disconnects ALL participants
// server-side — the authoritative way to end a class for everyone.
// Returns true if the delete request was issued, false if LiveKit isn't
// configured. Swallows "room not found" since an already-empty room is fine.
export async function deleteLiveKitRoom(roomName: string): Promise<boolean> {
  const svc = roomService();
  if (!svc || !roomName) return false;
  try {
    await svc.deleteRoom(roomName);
    return true;
  } catch (err: unknown) {
    // A room with no active participants may not exist on the LiveKit server.
    // That's not an error for our purposes — the goal (no one connected) holds.
    const msg = err instanceof Error ? err.message : String(err);
    if (/not\s*found|does not exist/i.test(msg)) return true;
    throw err;
  }
}
