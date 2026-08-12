# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
import json
from genlayer import *
from dataclasses import dataclass

MIN_GEN_WEI = 1 * 10**18
MAX_GEN_WEI = 5 * 10**18
INTEREST_BPS = 300  # 3%
SCAN_FEE_WEI = int(0.1 * 10**18)

TIER_CEILINGS = {
    "low":    5 * 10**18,
    "medium": 2 * 10**18,
    "high":   0,
}

@allow_storage
@dataclass
class Loan:
    principal_wei: u256
    owed_wei: u256
    due_at: str
    reason: str
    tier: str
    claimed: bool   # false = approved offer awaiting claim, true = funds actually disbursed
    active: bool     # only meaningful once claimed: true = outstanding, false = repaid/settled
    defaulted: bool

class LendingPool(gl.Contract):
    owner: Address
    api_base: str
    tx_base: str
    all_tx_url: str
    loans: TreeMap[Address, Loan]
    repayment_counts: TreeMap[Address, u256]
    last_decisions: TreeMap[Address, str]
    last_scans: TreeMap[Address, str]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.api_base = "https://explorer-api.testnet-chain.genlayer.com/address/"
        self.tx_base = "https://explorer-api.testnet-chain.genlayer.com/transactions?address="
        self.all_tx_url = "https://explorer-api.testnet-chain.genlayer.com/transactions?limit=10&page=1"

    @gl.public.write.payable
    def fund_pool(self):
        pass

    @gl.public.write
    def withdraw_funds(self, amount_gen: str, recipient: str) -> str:
        if str(gl.message.sender_address).lower() != str(self.owner).lower():
            def gen_result():
                return json.dumps({"success": False, "message": "Only the pool owner can withdraw funds."})
            return gl.eq_principle.strict_eq(gen_result)

        success = False
        message = ""
        try:
            amount_wei = int(float(amount_gen) * 10**18)
            recipient_addr = Address(recipient)

            @gl.evm.contract_interface
            class _Recipient:
                class View: pass
                class Write: pass

            _Recipient(recipient_addr).emit_transfer(value=u256(amount_wei))
            success = True
            message = f"Withdrew {amount_gen} GEN to {recipient}."
        except Exception as e:
            message = f"Withdrawal failed, likely insufficient pool balance: {str(e)}"

        def gen_result():
            return json.dumps({"success": success, "message": message})
        return gl.eq_principle.strict_eq(gen_result)

    @gl.public.write
    def request_loan(self, address: str, requested_gen: str, reason: str) -> str:
        addr = Address(address)

        # Only the wallet itself can request a loan on its own behalf. Without this,
        # anyone could name another wallet as the target, forcing an unwanted loan
        # and debt obligation onto them.
        if address.lower() != str(gl.message.sender_address).lower():
            def gen_result():
                return json.dumps({"approved": False, "reason_out": "You can only request a loan for your own connected wallet."})
            return gl.eq_principle.strict_eq(gen_result)

        existing = self.loans.get(addr, None)

        if existing is not None and existing.active:
            def gen_result():
                return json.dumps({"approved": False, "reason_out": "You already have an active loan. Repay it before requesting another."})
            return gl.eq_principle.strict_eq(gen_result)

        if existing is not None and existing.defaulted:
            def gen_result():
                return json.dumps({"approved": False, "reason_out": "This wallet has previously defaulted on a loan and is permanently ineligible until it's settled."})
            return gl.eq_principle.strict_eq(gen_result)

        if existing is not None and not existing.claimed and not existing.active and not existing.defaulted:
            def gen_result():
                return json.dumps({"approved": False, "reason_out": "You already have an approved offer waiting to be claimed. Claim it before applying again."})
            return gl.eq_principle.strict_eq(gen_result)

        api_base = self.api_base
        tx_base = self.tx_base
        repay_count = int(self.repayment_counts.get(addr, 0))

        def gen():
            try:
                from datetime import datetime

                url = api_base + address
                res = gl.nondet.web.get(url)
                data = json.loads(res.body.decode("utf-8"))

                gen_balance_wei = 0
                for token_addr, info in data.get("balances", {}).items():
                    token = info.get("token")
                    if token and token.get("symbol") == "GEN":
                        gen_balance_wei = int(info.get("balance", "0"))

                nonce = data.get("verifiedNonce", 0)

                tx_url = tx_base + address + "&limit=10&page=1"
                tx_res = gl.nondet.web.get(tx_url)
                tx_data = json.loads(tx_res.body.decode("utf-8"))
                items = tx_data.get("items", [])
                total_pages = tx_data.get("meta", {}).get("totalPages", 1)
                newest_ts = items[0].get("receivedAt") if items else None

                failed_count = 0
                for item in items:
                    if item.get("error") or item.get("revertReason"):
                        failed_count += 1

                last_url = tx_base + address + f"&limit=10&page={total_pages}"
                last_res = gl.nondet.web.get(last_url)
                last_data = json.loads(last_res.body.decode("utf-8"))
                last_items = last_data.get("items", [])
                oldest_ts = last_items[-1].get("receivedAt") if last_items else None

                age_days = 0
                if newest_ts and oldest_ts:
                    d1 = datetime.fromisoformat(newest_ts.replace("Z", "+00:00"))
                    d2 = datetime.fromisoformat(oldest_ts.replace("Z", "+00:00"))
                    age_days = (d1 - d2).days

                gen_balance = gen_balance_wei / 1e18

                if failed_count >= 2 or age_days < 14:
                    tier = "high"
                elif nonce >= 500 and gen_balance >= 50 and failed_count == 0 and age_days >= 60:
                    tier = "low"
                else:
                    tier = "medium"

                range_max_wei = TIER_CEILINGS[tier]

                # Real repayment history lifts the ceiling, capped so it can
                # never push past the global maximum regardless of tier.
                if range_max_wei > 0:
                    history_bonus_wei = min(repay_count * int(0.2 * 10**18), int(1 * 10**18))
                    range_max_wei = min(range_max_wei + history_bonus_wei, MAX_GEN_WEI)

                requested_wei = int(float(requested_gen) * 10**18)

                if requested_wei < MIN_GEN_WEI or requested_wei > MAX_GEN_WEI:
                    return json.dumps({
                        "approved": False, "tier": tier, "approved_wei": 0, "owed_wei": 0,
                        "reason_out": "Request must be between 1 and 5 GEN.",
                        "clarity": None, "nonce": nonce, "gen_balance": gen_balance,
                        "age_days": age_days, "failed_count": failed_count
                    }, sort_keys=True)

                if range_max_wei == 0:
                    return json.dumps({
                        "approved": False, "tier": tier, "approved_wei": 0, "owed_wei": 0,
                        "reason_out": f"Declined. Wallet tier is high risk (failed_count={failed_count}, age_days={age_days}). No reason text can override this.",
                        "clarity": None, "nonce": nonce, "gen_balance": gen_balance,
                        "age_days": age_days, "failed_count": failed_count
                    }, sort_keys=True)

                score_prompt = f"""Evaluate this loan purpose statement in two ways.

1. Does it explicitly state bad-faith intent, such as wanting to waste, destroy, or never repay the funds, or an illegal or harmful use? Only answer true for explicit statements like this, not for vague, empty, or merely low-effort statements.
2. If not flagged for bad faith, classify its clarity and specificity into exactly one of three labels: "low" (vague, generic, or empty), "medium" (some real detail but not fully concrete), or "high" (specific, concrete, plausible). This does NOT verify truthfulness, only how clearly it's written.

Statement: "{reason}"

Respond ONLY with JSON in this exact format, nothing else:
{{"bad_faith": <true|false>, "clarity": "<low|medium|high>"}}
"""
                score_result = gl.nondet.exec_prompt(score_prompt, response_format="json")
                bad_faith = bool(score_result.get("bad_faith", False))
                clarity = score_result.get("clarity", "low")
                if clarity not in ("low", "medium", "high"):
                    clarity = "low"

                if bad_faith:
                    return json.dumps({
                        "approved": False, "tier": tier, "approved_wei": 0, "owed_wei": 0,
                        "reason_out": "Declined. Stated purpose indicates bad-faith intent, regardless of wallet standing.",
                        "clarity": clarity, "nonce": nonce, "gen_balance": gen_balance,
                        "age_days": age_days, "failed_count": failed_count
                    }, sort_keys=True)

                # The tier sets the ceiling, the global minimum sets the floor
                # for everyone, so a weak reason has real downside regardless
                # of tier, not just a smaller upside. Clarity is a discrete
                # label, not a continuous score, specifically so every
                # validator lands on the exact same principal, not just the
                # same tier, three possible outcomes is small enough that
                # independent LLM calls actually converge.
                effective_max_wei = min(range_max_wei, requested_wei)
                effective_min_wei = min(MIN_GEN_WEI, effective_max_wei)
                span_wei = effective_max_wei - effective_min_wei
                clarity_fraction = {"low": 0.2, "medium": 0.6, "high": 1.0}[clarity]
                approved_wei = effective_min_wei + int(span_wei * clarity_fraction)

                owed_wei = int(approved_wei * (10000 + INTEREST_BPS) / 10000)

                reason_out = (
                    f"Approved for {approved_wei/1e18} GEN. Tier {tier} sets a ceiling of "
                    f"{range_max_wei/1e18} GEN"
                    f"{f' (lifted by {repay_count} prior repayment(s))' if repay_count > 0 else ''}, "
                    f"reason clarity rated {clarity} placed it between {MIN_GEN_WEI/1e18} "
                    f"and that ceiling, capped by your request of {requested_gen} GEN. Claim it "
                    f"to receive the GEN and start the 7-day repayment clock."
                )

                return json.dumps({
                    "approved": True,
                    "tier": tier,
                    "approved_wei": approved_wei,
                    "owed_wei": owed_wei,
                    "reason_out": reason_out,
                    "clarity": clarity,
                    "repay_count": repay_count,
                    "nonce": nonce,
                    "gen_balance": gen_balance,
                    "age_days": age_days,
                    "failed_count": failed_count
                }, sort_keys=True)
            except Exception as e:
                return json.dumps({"error": str(e), "error_type": type(e).__name__})

        # Now requires exact agreement on tier, approval outcome, AND the
        # principal itself, only wording is allowed to differ. The clarity
        # bucket above is what makes that achievable in practice.
        principle = "The results are equivalent only if they report the same tier, the same approved/declined outcome, and the exact same approved_wei. The reason_out wording may differ."
        raw = gl.eq_principle.prompt_comparative(gen, principle)
        result = json.loads(raw)

        # Persist the decision so the frontend can reliably read it back via a
        # view call, write-transaction return values don't decode cleanly
        # through genlayer-js yet.
        self.last_decisions[addr] = json.dumps(result, sort_keys=True)

        if result.get("approved"):
            # Approval only creates a claimable offer, no GEN moves here.
            # due_at is left blank, it gets set for real at claim time, so the
            # repayment clock starts when the funds actually arrive, not
            # while the offer is just sitting there unclaimed.
            self.loans[addr] = Loan(
                principal_wei=u256(result["approved_wei"]),
                owed_wei=u256(result["owed_wei"]),
                due_at="",
                reason=reason,
                tier=result.get("tier", ""),
                claimed=False,
                active=False,
                defaulted=False
            )

        return json.dumps(result, sort_keys=True)

    @gl.public.write
    def claim_loan(self, address: str) -> str:
        addr = Address(address)

        if address.lower() != str(gl.message.sender_address).lower():
            def gen_result():
                return json.dumps({"success": False, "message": "You can only claim a loan for your own connected wallet."})
            raw = gl.eq_principle.strict_eq(gen_result)
            self.last_decisions[addr] = raw
            return raw

        loan = self.loans.get(addr, None)
        if loan is None or loan.claimed or loan.active or loan.defaulted:
            def gen_result():
                return json.dumps({"success": False, "message": "No unclaimed offer found for this wallet."})
            raw = gl.eq_principle.strict_eq(gen_result)
            self.last_decisions[addr] = raw
            return raw

        tx_base = self.tx_base

        def gen():
            try:
                from datetime import datetime, timedelta
                url = tx_base + address + "&limit=10&page=1"
                res = gl.nondet.web.get(url)
                data = json.loads(res.body.decode("utf-8"))
                items = data.get("items", [])
                now_ts = items[0].get("receivedAt") if items else None
                if not now_ts:
                    return json.dumps({"error": "no reference timestamp available"})
                now_dt = datetime.fromisoformat(now_ts.replace("Z", "+00:00"))
                due_at = (now_dt + timedelta(days=7)).isoformat()
                return json.dumps({"due_at": due_at})
            except Exception as e:
                return json.dumps({"error": str(e), "error_type": type(e).__name__})

        raw = gl.eq_principle.strict_eq(gen)
        result = json.loads(raw)

        if result.get("error") or not result.get("due_at"):
            error_response = json.dumps({"success": False, "message": "Could not establish a repayment deadline right now, try claiming again shortly."})
            self.last_decisions[addr] = error_response
            return error_response

        approved_wei = int(loan.principal_wei)

        try:
            @gl.evm.contract_interface
            class _Recipient:
                class View: pass
                class Write: pass

            # Transfer attempted first, on purpose. State is only committed
            # after this succeeds, so a failed transfer never leaves anything
            # to roll back, there's nothing written yet to undo.
            _Recipient(addr).emit_transfer(value=u256(approved_wei))

            self.loans[addr] = Loan(
                principal_wei=loan.principal_wei,
                owed_wei=loan.owed_wei,
                due_at=result["due_at"],
                reason=loan.reason,
                tier=loan.tier,
                claimed=True,
                active=True,
                defaulted=False
            )

            success_response = json.dumps({
                "success": True,
                "message": "Loan claimed.",
                "approved_wei": approved_wei,
                "owed_wei": int(loan.owed_wei),
                "due_at": result["due_at"]
            })
            self.last_decisions[addr] = success_response
            return success_response
        except Exception as e:
            # Nothing was written above the failed transfer, so there's
            # nothing to restore, the original unclaimed offer was simply
            # never touched.
            error_response = json.dumps({"success": False, "message": f"Claim failed, nothing was disbursed, your offer is still available to retry: {str(e)}", "error_type": type(e).__name__})
            self.last_decisions[addr] = error_response
            return error_response

    @gl.public.write.payable
    def repay_loan(self, address: str) -> str:
        addr = Address(address)
        loan = self.loans.get(addr, None)

        # A defaulted loan can still be repaid to clear the ban, only a wallet
        # with no loan at all, or one already fully settled, is turned away here.
        if loan is None or (not loan.active and not loan.defaulted):
            def gen_result():
                return json.dumps({"success": False, "message": "No open balance found for this wallet."})
            raw = gl.eq_principle.strict_eq(gen_result)
            self.last_decisions[addr] = raw
            return raw

        received_wei = int(gl.message.value)
        owed_wei = int(loan.owed_wei)

        if received_wei < owed_wei:
            def gen_result():
                return json.dumps({"success": False, "message": f"Insufficient repayment. Owed {owed_wei/1e18} GEN, received {received_wei/1e18} GEN."})
            raw = gl.eq_principle.strict_eq(gen_result)
            self.last_decisions[addr] = raw
            return raw

        was_defaulted = loan.defaulted
        excess_wei = received_wei - owed_wei

        self.loans[addr] = Loan(
            principal_wei=loan.principal_wei, owed_wei=loan.owed_wei, due_at=loan.due_at,
            reason=loan.reason, tier=loan.tier, claimed=True, active=False, defaulted=False
        )
        current = self.repayment_counts.get(addr, 0)
        self.repayment_counts[addr] = current + 1

        try:
            if excess_wei > 0:
                @gl.evm.contract_interface
                class _Recipient:
                    class View: pass
                    class Write: pass
                _Recipient(gl.message.sender_address).emit_transfer(value=u256(excess_wei))

            message = "Defaulted loan settled, this wallet is eligible again." if was_defaulted else "Loan repaid in full."
            def gen_result():
                return json.dumps({"success": True, "message": message, "refunded_wei": excess_wei})
            raw = gl.eq_principle.strict_eq(gen_result)
            self.last_decisions[addr] = raw
            return raw
        except Exception as e:
            def gen_error():
                return json.dumps({"success": False, "message": f"Repayment recorded but refund failed: {str(e)}", "error_type": type(e).__name__})
            err_raw = gl.eq_principle.strict_eq(gen_error)
            self.last_decisions[addr] = err_raw
            return err_raw

    @gl.public.write
    def check_default(self, address: str) -> str:
        addr = Address(address)
        loan = self.loans.get(addr, None)
        if loan is None or not loan.active:
            def gen_no_loan():
                return json.dumps({"defaulted": False, "message": "No active loan to check."})
            return gl.eq_principle.strict_eq(gen_no_loan)

        contract_addr_str = str(self.address)
        tx_base = self.tx_base
        all_tx_url = self.all_tx_url
        due_at_str = loan.due_at

        def gen():
            try:
                from datetime import datetime

                now_ts = None
                # Prefer the network-wide feed, a live testnet has far more
                # consistent traffic than any single address, including this
                # contract's own, so it's a fresher, more reliable clock.
                res = gl.nondet.web.get(all_tx_url)
                data = json.loads(res.body.decode("utf-8"))
                items = data.get("items", [])
                if items:
                    now_ts = items[0].get("receivedAt")

                if not now_ts:
                    # Network feed was empty, fall back to the contract's
                    # own transaction history as the reference instead.
                    fallback_url = tx_base + contract_addr_str + "&limit=10&page=1"
                    res2 = gl.nondet.web.get(fallback_url)
                    data2 = json.loads(res2.body.decode("utf-8"))
                    items2 = data2.get("items", [])
                    now_ts = items2[0].get("receivedAt") if items2 else None

                if not now_ts:
                    return json.dumps({"error": "no reference timestamp available from either source"})
                now_dt = datetime.fromisoformat(now_ts.replace("Z", "+00:00"))
                due_dt = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
                return json.dumps({"is_late": now_dt > due_dt, "now_ts": now_ts})
            except Exception as e:
                return json.dumps({"error": str(e), "error_type": type(e).__name__})

        raw = gl.eq_principle.strict_eq(gen)
        result = json.loads(raw)

        if result.get("is_late"):
            self.loans[addr] = Loan(
                principal_wei=loan.principal_wei, owed_wei=loan.owed_wei, due_at=loan.due_at,
                reason=loan.reason, tier=loan.tier, claimed=True, active=False, defaulted=True
            )
            return json.dumps({"defaulted": True, "message": "Loan marked as defaulted, past due date."})
        return json.dumps({"defaulted": False, "message": "Not yet past due.", "detail": result})

    @gl.public.view
    def get_last_decision(self, address: str) -> str:
        addr = Address(address)
        return self.last_decisions.get(addr, json.dumps({"error": "No decision found for this wallet."}))

    @gl.public.write.payable
    def scan_wallet(self, address: str) -> str:
        if int(gl.message.value) < SCAN_FEE_WEI:
            def gen_result():
                return json.dumps({"error": f"Scan requires a fee of at least {SCAN_FEE_WEI/1e18} GEN."})
            raw = gl.eq_principle.strict_eq(gen_result)
            self.last_scans[Address(address)] = raw
            return raw

        api_base = self.api_base
        tx_base = self.tx_base

        def gen():
            try:
                from datetime import datetime

                url = api_base + address
                res = gl.nondet.web.get(url)
                data = json.loads(res.body.decode("utf-8"))

                gen_balance_wei = 0
                unrecognized_tokens = 0
                for token_addr, info in data.get("balances", {}).items():
                    token = info.get("token")
                    if token and token.get("symbol") == "GEN":
                        gen_balance_wei = int(info.get("balance", "0"))
                    elif token is None:
                        unrecognized_tokens += 1

                gen_balance = gen_balance_wei / 1e18
                nonce = data.get("verifiedNonce", 0)

                tx_url = tx_base + address + "&limit=10&page=1"
                tx_res = gl.nondet.web.get(tx_url)
                tx_data = json.loads(tx_res.body.decode("utf-8"))
                items = tx_data.get("items", [])
                total_pages = tx_data.get("meta", {}).get("totalPages", 1)
                newest_ts = items[0].get("receivedAt") if items else None

                failed_count = 0
                total_fee_wei = 0
                total_value_wei = 0
                tx_lines = []
                timeline = []
                values_wei = []
                for item in items:
                    is_failed = bool(item.get("error") or item.get("revertReason"))
                    if is_failed:
                        failed_count += 1
                    fee_wei_i = int(item.get("fee") or "0")
                    value_wei_i = int(item.get("value") or "0")
                    total_fee_wei += fee_wei_i
                    total_value_wei += value_wei_i
                    values_wei.append(value_wei_i)
                    tx_lines.append(f"{item.get('receivedAt')} status={item.get('status')}")
                    timeline.append({
                        "hash": item.get("hash"),
                        "receivedAt": item.get("receivedAt"),
                        "status": item.get("status"),
                        "failed": is_failed,
                        "value_gen": round(value_wei_i / 1e18, 6),
                        "fee_gen": round(fee_wei_i / 1e18, 6),
                    })

                recent_tx_text = "\n".join(tx_lines) if tx_lines else "No recent transactions found."
                total_fee_gen = total_fee_wei / 1e18
                total_value_gen = total_value_wei / 1e18

                min_value_gen = round(min(values_wei) / 1e18, 6) if values_wei else 0
                max_value_gen = round(max(values_wei) / 1e18, 6) if values_wei else 0
                avg_value_gen = round((sum(values_wei) / len(values_wei)) / 1e18, 6) if values_wei else 0

                last_url = tx_base + address + f"&limit=10&page={total_pages}"
                last_res = gl.nondet.web.get(last_url)
                last_data = json.loads(last_res.body.decode("utf-8"))
                last_items = last_data.get("items", [])
                oldest_ts = last_items[-1].get("receivedAt") if last_items else None

                age_days = 0
                if newest_ts and oldest_ts:
                    d1 = datetime.fromisoformat(newest_ts.replace("Z", "+00:00"))
                    d2 = datetime.fromisoformat(oldest_ts.replace("Z", "+00:00"))
                    age_days = (d1 - d2).days

                if failed_count >= 2 or age_days < 14:
                    tier = "high"
                    band_range = (51, 90)
                elif nonce >= 500 and gen_balance >= 50 and failed_count == 0 and age_days >= 60:
                    tier = "low"
                    band_range = (5, 20)
                else:
                    tier = "medium"
                    band_range = (21, 50)

                criteria_met = {
                    "nonce_threshold": nonce >= 500,
                    "balance_threshold": gen_balance >= 50,
                    "zero_recent_failures": failed_count == 0,
                    "age_threshold": age_days >= 60,
                }

                prompt = f"""You are a wallet risk analyst on the GenLayer testnet. The tier has already been decided deterministically, your job is only to pick a specific score within the given band and write two short text fields.

Wallet: {address}
GEN balance: {gen_balance}
Verified nonce (total transactions sent): {nonce}
Wallet age (days between oldest and newest known transaction): {age_days}
Unrecognized token holdings (no metadata, possible spam or dust): {unrecognized_tokens}
Total gas fees paid across last {len(items)} transactions: {total_fee_gen:.6f} GEN
Total GEN value moved across last {len(items)} transactions: {total_value_gen:.6f} GEN
Transaction size spread: min {min_value_gen} GEN, max {max_value_gen} GEN, average {avg_value_gen} GEN
Failed or reverted transactions in that same window: {failed_count}

Recent transactions:
{recent_tx_text}

Decided tier: {tier}
Score range for this tier: between {band_range[0]} and {band_range[1]}

Write a short behavioral characterization, one to two sentences, describing what type of wallet this looks like based on the overall pattern taken together. Do not just restate individual numbers, synthesize them.

Respond ONLY with JSON in this exact format, nothing else:
{{"score": <integer within the given range>, "reasoning": "<one short sentence citing the actual numbers used>", "behavior_profile": "<one to two sentence synthesized characterization>"}}
"""
                result = gl.nondet.exec_prompt(prompt, response_format="json")
                result["tier"] = tier
                result["criteria_met"] = criteria_met
                result["gen_balance"] = gen_balance
                result["nonce"] = nonce
                result["age_days"] = age_days
                result["total_fee_gen"] = round(total_fee_gen, 6)
                result["total_value_gen"] = round(total_value_gen, 6)
                result["min_value_gen"] = min_value_gen
                result["max_value_gen"] = max_value_gen
                result["avg_value_gen"] = avg_value_gen
                result["unrecognized_tokens"] = unrecognized_tokens
                result["failed_count"] = failed_count
                result["timeline"] = timeline
                return json.dumps(result, sort_keys=True)
            except Exception as e:
                return json.dumps({"error": str(e), "error_type": type(e).__name__})

        principle = "The results are equivalent if they report the same tier (low, medium, or high). The exact score number, the criteria_met wording, the reasoning sentence, the behavior_profile narrative, and the timeline/size-spread figures are all allowed to differ, since wallet activity can shift slightly between validator calls."
        raw = gl.eq_principle.prompt_comparative(gen, principle)
        self.last_scans[Address(address)] = raw
        return raw

    @gl.public.view
    def get_last_scan(self, address: str) -> str:
        addr = Address(address)
        return self.last_scans.get(addr, json.dumps({"error": "No scan found for this wallet yet."}))

    @gl.public.view
    def get_repayment_count(self, address: str) -> str:
        addr = Address(address)
        count = self.repayment_counts.get(addr, 0)
        return json.dumps({"repayment_count": int(count)})

    @gl.public.view
    def get_pool_balance(self) -> str:
        return json.dumps({"balance_gen": int(self.balance) / 1e18})

    @gl.public.view
    def get_loan(self, address: str) -> str:
        addr = Address(address)
        loan = self.loans.get(addr, None)
        if loan is None:
            return json.dumps({"exists": False, "active": False, "claimed": False, "defaulted": False})
        return json.dumps({
            "exists": True,
            "principal_gen": int(loan.principal_wei) / 1e18,
            "owed_gen": int(loan.owed_wei) / 1e18,
            "due_at": loan.due_at,
            "reason": loan.reason,
            "tier": loan.tier,
            "claimed": loan.claimed,
            "active": loan.active,
            "defaulted": loan.defaulted
        })
