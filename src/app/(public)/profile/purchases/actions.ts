"use server";

import { revalidatePath } from "next/cache";
import { actionClient } from "@/lib/auth/actionClient";
import { redeemCredit, requestCreditRefund } from "@/lib/db/purchases";

export async function redeemCreditAction(creditId: string, occurrenceId: string) {
  const client = await actionClient();
  
  try {
    await redeemCredit(client, creditId, occurrenceId);
    revalidatePath("/profile/purchases");
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function requestRefundAction(creditId: string) {
  const client = await actionClient();
  
  try {
    await requestCreditRefund(client, creditId);
    revalidatePath("/profile/purchases");
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "Unknown error" };
  }
}
