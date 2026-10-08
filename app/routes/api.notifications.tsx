import type { ActionFunctionArgs } from "react-router";
import { markNotificationRead, markAllNotificationsRead } from "../services/notification.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const actionType = String(formData.get("actionType") || "");

  if (actionType === "mark_read") {
    const notificationId = String(formData.get("notificationId") || "");
    const recipientId = formData.get("recipientId") ? String(formData.get("recipientId")) : undefined;

    if (!notificationId) {
      return new Response(JSON.stringify({ success: false, error: "Missing notificationId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await markNotificationRead(notificationId, recipientId);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (actionType === "mark_all_read") {
    const recipientType = (formData.get("recipientType") as "ADMIN" | "CUSTOMER") || "CUSTOMER";
    const recipientId = String(formData.get("recipientId") || "");
    const campaignId = formData.get("campaignId") ? String(formData.get("campaignId")) : undefined;

    if (!recipientId) {
      return new Response(JSON.stringify({ success: false, error: "Missing recipientId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await markAllNotificationsRead({ recipientType, recipientId, campaignId });
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: false, error: "Invalid action" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
};
