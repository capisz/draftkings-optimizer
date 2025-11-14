import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    envLoaded: !!process.env.NEXT_PUBLIC_BALLDONTLIE_API_KEY,
    keyValue: process.env.NEXT_PUBLIC_BALLDONTLIE_API_KEY || null,
  });
}
