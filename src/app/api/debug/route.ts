import { NextResponse } from "next/server";

export async function GET() {
  console.log("Loaded key (from server):", process.env.NEXT_PUBLIC_BALLDONTLIE_API_KEY);
  return NextResponse.json({
    loaded: !!process.env.NEXT_PUBLIC_BALLDONTLIE_API_KEY,
    value: process.env.NEXT_PUBLIC_BALLDONTLIE_API_KEY || "(empty)",
  });
}
