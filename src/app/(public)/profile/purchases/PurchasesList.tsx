"use client";

import { useState } from "react";
import { he } from "@/lib/i18n/he";
import { redeemCreditAction, requestRefundAction } from "./actions";
import { formatNumericDate } from "@/lib/domain/occurrenceTime";
import type { MyTicket, MyPunchCard, MyCreditWithOccurrences, UpcomingOccurrence } from "@/lib/db/purchases";

export function PurchasesList({ tickets, punchCards, credits }: { tickets: MyTicket[], punchCards: MyPunchCard[], credits: MyCreditWithOccurrences[] }) {
  const hasPurchases = tickets.length > 0 || punchCards.length > 0 || credits.length > 0;

  if (!hasPurchases) {
    return <p className="text-lg">{he.purchases.noPurchases}</p>;
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="font-display text-2xl font-bold mb-4">{he.purchases.ticketsHeading}</h2>
        {tickets.length === 0 ? (
          <p className="text-muted text-lg">{he.purchases.noTickets}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {tickets.map(ticket => (
              <li key={ticket.id} className="border-2 border-muted/30 rounded-2xl p-4">
                <div className="font-bold text-lg">
                  {ticket.event_occurrences?.dance_events?.instructors?.display_name || "ריקוד"}
                </div>
                <div className="text-lg">
                  {ticket.event_occurrences?.starts_at ? formatNumericDate(ticket.event_occurrences.starts_at) : ""}
                </div>
                <div className="text-lg">
                  {ticket.event_occurrences?.override_venue?.name || ticket.event_occurrences?.dance_events?.venues?.name}
                </div>
                <div className="text-lg font-semibold mt-1">
                  {he.purchases.ticketStatusLabel(he.purchases.ticketStatuses[ticket.status])}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-2xl font-bold mb-4">{he.purchases.punchCardsHeading}</h2>
        {punchCards.length === 0 ? (
          <p className="text-muted text-lg">{he.purchases.noPunchCards}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {punchCards.map(card => (
              <li key={card.id} className="border-2 border-muted/30 rounded-2xl p-4">
                <div className="font-bold text-lg">{card.instructors?.display_name}</div>
                <div className="text-lg">
                  {he.purchases.remainingUses(card.remaining_uses, card.total_uses)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-2xl font-bold mb-4">{he.purchases.creditsHeading}</h2>
        {credits.length === 0 ? (
          <p className="text-muted text-lg">{he.purchases.noCredits}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {credits.map(credit => (
              <CreditItem key={credit.id} credit={credit} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreditItem({ credit }: { credit: MyCreditWithOccurrences }) {
  const [selectedOccurrence, setSelectedOccurrence] = useState<string>("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showRedeemForm, setShowRedeemForm] = useState(false);

  const isRefundEligible = (credit.status === 'expired' || credit.status === 'active') && new Date() >= new Date(credit.expires_at) && !credit.refund_requested_at;
  const isRedeemable = credit.status === 'active' && new Date() < new Date(credit.expires_at) && credit.remaining_agorot > 0;

  async function handleRedeem() {
    if (!selectedOccurrence) return;
    setIsRedeeming(true);
    setError(null);
    setSuccessMsg(null);
    
    const result = await redeemCreditAction(credit.id, selectedOccurrence);
    setIsRedeeming(false);
    
    if (result.success) {
      setSuccessMsg(he.purchases.redeemSuccess);
      setShowRedeemForm(false);
    } else {
      setError(result.error ?? "Unknown error");
    }
  }

  async function handleRefund() {
    setIsRefunding(true);
    setError(null);
    setSuccessMsg(null);
    
    const result = await requestRefundAction(credit.id);
    setIsRefunding(false);
    
    if (result.success) {
      setSuccessMsg(he.purchases.refundSuccess);
    } else {
      setError(result.error ?? "Unknown error");
    }
  }

  return (
    <li className="border-2 border-muted/30 rounded-2xl p-4 flex flex-col gap-2">
      <div className="font-bold text-lg">{credit.instructors?.display_name}</div>
      <div className="text-xl text-secondary font-black">
        {he.purchases.creditAmount(credit.remaining_agorot / 100)}
      </div>
      
      {credit.refund_requested_at ? (
        <div className="text-lg font-semibold text-muted">{he.purchases.refundRequested}</div>
      ) : (
        <div className="text-lg">
          {he.purchases.expiresAt(formatNumericDate(credit.expires_at))}
        </div>
      )}

      <div aria-live="polite">
        {error && <div className="text-red-600 font-bold text-lg mt-2">{error}</div>}
        {successMsg && <div className="text-green-600 font-bold text-lg mt-2">{successMsg}</div>}
      </div>

      {isRedeemable && !showRedeemForm && (
        <button 
          onClick={() => setShowRedeemForm(true)}
          className="mt-2 bg-secondary text-surface py-2 px-4 rounded-full font-bold focus-visible:outline-4 focus-visible:outline-secondary w-max min-h-[48px] text-lg"
        >
          {he.purchases.useCredit}
        </button>
      )}

      {showRedeemForm && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="font-bold text-lg" htmlFor={`select-${credit.id}`}>
            {he.purchases.selectDanceLabel}
          </label>
          <select 
            id={`select-${credit.id}`}
            className="border-2 border-muted/50 rounded-lg p-2 bg-surface min-h-[48px] text-lg"
            value={selectedOccurrence}
            onChange={e => setSelectedOccurrence(e.target.value)}
          >
            <option value="">{he.purchases.selectDanceLabel}</option>
            {credit.occurrences?.map((occ: UpcomingOccurrence) => (
              <option key={occ.id} value={occ.id}>
                {formatNumericDate(occ.starts_at)} - {occ.override_venue?.name || occ.dance_events?.venues?.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mt-2">
            <button 
              onClick={handleRedeem}
              disabled={!selectedOccurrence || isRedeeming}
              className="flex-1 bg-secondary text-surface py-2 rounded-full font-bold disabled:opacity-50 min-h-[48px] text-lg"
            >
              {he.purchases.redeemButton}
            </button>
            <button 
              onClick={() => setShowRedeemForm(false)}
              className="px-4 border-2 border-secondary text-secondary rounded-full font-bold min-h-[48px] text-lg"
            >
              {he.purchases.cancelRedeem}
            </button>
          </div>
        </div>
      )}

      {isRefundEligible && !credit.refund_requested_at && (
        <button 
          onClick={handleRefund}
          disabled={isRefunding}
          className="mt-2 border-2 border-secondary text-secondary py-2 px-4 rounded-full font-bold disabled:opacity-50 focus-visible:outline-4 focus-visible:outline-secondary w-max min-h-[48px] text-lg"
        >
          {he.purchases.requestRefund}
        </button>
      )}
    </li>
  );
}
