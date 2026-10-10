import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

type Participant = any;

export function ExpandableParticipantRow({ p, campaign }: { p: Participant; campaign: any }) {
  const [expanded, setExpanded] = useState(false);
  const fetcher = useFetcher<any>();
  const isEligible = p.totalPoints >= campaign.maxPoints || p.status === "eligible" || p.status === "completed" || p.status === "winner";

  useEffect(() => {
    if (expanded && fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(`/api/admin/customer/${p.id}`);
    }
  }, [expanded, fetcher, p.id]);

  const handleSyncOrders = () => {
    fetcher.submit(
      { intent: "sync_orders" },
      { method: "post", action: `/api/admin/customer/${p.id}` }
    );
  };

  const dbName = p.displayName?.trim();
  const rawIdDigits = p.shopifyCustomerId.replace(/\D/g, "");
  const fallback = rawIdDigits.slice(-6) ? `Customer ...${rawIdDigits.slice(-6)}` : p.shopifyCustomerId;

  return (
    <>
      <tr onClick={() => setExpanded(!expanded)} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: expanded ? "#f8fafc" : "transparent" }}>
        <td style={{ padding: "14px 16px", fontWeight: "bold", color: p.calculatedRank <= 3 ? "#d97706" : "#4b5563" }}>
          #{p.calculatedRank}
        </td>
        <td style={{ padding: "14px 16px" }}>
          <div style={{ fontWeight: 600, color: "#111827" }}>
            {dbName || fallback}
          </div>
          <span style={{ fontSize: "11px", color: "#9ca3af" }}>ID: {p.shopifyCustomerId}</span>
        </td>
        <td style={{ padding: "14px 16px" }}>
          <span style={{ fontSize: "14px", fontWeight: "bold", color: "#059669" }}>
            {p.totalPoints} pts
          </span>
          <div style={{ fontSize: "11px", color: "#9ca3af" }}>
            {Math.round((p.totalPoints / campaign.maxPoints) * 100)}% to goal
          </div>
        </td>
        <td style={{ padding: "14px 16px" }}>
          <span style={{ background: "#e0e7ff", color: "#3730a3", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
            Day {p.currentLevel}
          </span>
        </td>
        <td style={{ padding: "14px 16px", color: "#4b5563" }}>
          {p._count.submissions} submissions ({p._count.pointTransactions} txs)
        </td>
        <td style={{ padding: "14px 16px" }}>
          <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 700, background: isEligible ? "#dcfce7" : "#f3f4f6", color: isEligible ? "#166534" : "#6b7280", textTransform: "uppercase" }}>
            {isEligible ? "✓ Eligible" : "In Progress"}
          </span>
        </td>
        <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: "12px" }}>
          {new Date(p.createdAt).toLocaleDateString()}
          <div style={{ fontSize: "11px", color: "#2563eb", marginTop: "4px" }}>
            {expanded ? "Hide Details ▲" : "View Details ▼"}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: "0" }}>
            <div style={{ background: "#f8fafc", padding: "24px", borderBottom: "1px solid #e1e3e5", borderTop: "1px dashed #cbd5e1" }}>
              {fetcher.state === "loading" && !fetcher.data ? (
                <div style={{ color: "#64748b" }}>Loading participant details...</div>
              ) : fetcher.data?.error ? (
                <div style={{ color: "#ef4444" }}>Error loading details: {fetcher.data.error}</div>
              ) : fetcher.data ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                  {/* Left Column: Customer Profile & Activity */}
                  <div>
                    <h3 style={{ margin: "0 0 12px", fontSize: "15px", color: "#0f172a" }}>Customer Profile</h3>
                    <div style={{ background: "#fff", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                      <div style={{ marginBottom: "8px" }}><strong>Name:</strong> {fetcher.data.shopifyName || dbName || "Not available"}</div>
                      <div style={{ marginBottom: "8px" }}><strong>Email:</strong> {fetcher.data.email || "Not available"}</div>
                      <div style={{ marginBottom: "8px" }}><strong>Phone:</strong> {fetcher.data.phone || "Not available"}</div>
                      <div style={{ marginBottom: "8px" }}><strong>Shopify ID:</strong> {p.shopifyCustomerId}</div>
                      <div style={{ marginBottom: "8px" }}><strong>Internal ID:</strong> {p.id}</div>
                      <div style={{ marginBottom: "0" }}><strong>Joined:</strong> {new Date(p.createdAt).toLocaleString()}</div>
                    </div>

                    <h3 style={{ margin: "24px 0 12px", fontSize: "15px", color: "#0f172a" }}>Login & Activity History</h3>
                    <div style={{ background: "#fff", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", maxHeight: "200px", overflowY: "auto" }}>
                      {fetcher.data.auditLogs?.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "#475569" }}>
                          {fetcher.data.auditLogs.map((log: any) => (
                            <li key={log.id} style={{ marginBottom: "6px" }}>
                              <strong>{log.eventType}</strong> - {new Date(log.createdAt).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div style={{ color: "#94a3b8", fontSize: "13px" }}>No recent login or activity events recorded.</div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Orders & Day 9 */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <h3 style={{ margin: 0, fontSize: "15px", color: "#0f172a" }}>Shopify Orders (Day 9 Status)</h3>
                      <button 
                        onClick={handleSyncOrders}
                        disabled={fetcher.state !== "idle"}
                        style={{ background: "#2563eb", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "bold" }}
                      >
                        {fetcher.state !== "idle" ? "Syncing..." : "Sync Orders"}
                      </button>
                    </div>
                    
                    {fetcher.data.message && (
                      <div style={{ background: "#dcfce7", color: "#166534", padding: "8px 12px", borderRadius: "6px", marginBottom: "12px", fontSize: "13px" }}>
                        {fetcher.data.message}
                      </div>
                    )}
                    
                    <div style={{ background: "#fff", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", maxHeight: "300px", overflowY: "auto" }}>
                      {fetcher.data.progress?.purchaseVerifications?.length > 0 ? (
                        fetcher.data.progress.purchaseVerifications.map((order: any) => {
                          const isQualifying = order.completedAt != null;
                          return (
                            <div key={order.id} style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "6px", marginBottom: "12px", background: isQualifying ? "#f0fdf4" : "#f8fafc" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                                <strong>Order {order.orderName || order.shopifyOrderId}</strong>
                                <span style={{ color: isQualifying ? "#166534" : "#475569", fontWeight: "bold", fontSize: "12px" }}>
                                  {isQualifying ? "✓ QUALIFYING" : "PENDING/NON-QUALIFYING"}
                                </span>
                              </div>
                              <div style={{ fontSize: "13px", color: "#475569", marginBottom: "4px" }}><strong>Total:</strong> ₹{order.totalPrice}</div>
                              <div style={{ fontSize: "13px", color: "#475569", marginBottom: "4px" }}><strong>Paid At:</strong> {new Date(order.paidAt).toLocaleString()}</div>
                              <div style={{ fontSize: "13px", color: "#475569", marginBottom: "4px" }}><strong>Points Awarded:</strong> {isQualifying ? "100 pts" : "0 pts"}</div>
                              {!isQualifying && <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "8px" }}>Reason: Needs verification, unpaid, or does not meet ₹299 threshold.</div>}
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ color: "#94a3b8", fontSize: "13px" }}>No qualifying orders found. Click Sync Orders to fetch from Shopify.</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
