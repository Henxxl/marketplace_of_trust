import { useState, useEffect, useCallback } from "react";
import { Connection, PublicKey, SystemProgram, clusterApiUrl } from "@solana/web3.js";
import { Program, AnchorProvider, BN, utils } from "@coral-xyz/anchor";

// ── CONFIG ─────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("FWe29tk47GWzTXJDBQTNU85bHR3wg6wbQ1XbLuYPoyza");
const NETWORK = clusterApiUrl("devnet");
const CONNECTION = new Connection(NETWORK, "confirmed");

const IDL = {
  address: "FWe29tk47GWzTXJDBQTNU85bHR3wg6wbQ1XbLuYPoyza",
  metadata: { name: "workspace", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "register_agent",
      discriminator: [135, 157, 66, 195, 2, 113, 175, 30],
      accounts: [
        { name: "config", writable: true, pda: { seeds: [{ kind: "const", value: [99, 111, 110, 102, 105, 103] }, { kind: "account", path: "config.authority", account: "Config" }] } },
        { name: "agent", writable: true, pda: { seeds: [{ kind: "const", value: [97, 103, 101, 110, 116] }, { kind: "account", path: "owner" }] } },
        { name: "owner", writable: true, signer: true },
        { name: "system_program", address: "11111111111111111111111111111111" }
      ],
      args: [{ name: "agent_name", type: "string" }, { name: "agent_uri", type: "string" }]
    },
    {
      name: "stake_vouch",
      discriminator: [197, 19, 16, 117, 107, 175, 89, 105],
      accounts: [
        { name: "config", writable: true, pda: { seeds: [{ kind: "const", value: [99, 111, 110, 102, 105, 103] }, { kind: "account", path: "config.authority", account: "Config" }] } },
        { name: "agent", writable: true, pda: { seeds: [{ kind: "const", value: [97, 103, 101, 110, 116] }, { kind: "account", path: "agent.owner", account: "Agent" }] } },
        { name: "stake", writable: true, pda: { seeds: [{ kind: "const", value: [115, 116, 97, 107, 101] }, { kind: "account", path: "voucher" }, { kind: "account", path: "agent" }] } },
        { name: "vault", writable: true, pda: { seeds: [{ kind: "const", value: [118, 97, 117, 108, 116] }, { kind: "account", path: "config.authority", account: "Config" }] } },
        { name: "voucher", writable: true, signer: true },
        { name: "system_program", address: "11111111111111111111111111111111" }
      ],
      args: [{ name: "amount", type: "u64" }]
    },
    {
      name: "delegate_funds",
      discriminator: [201, 45, 22, 155, 140, 30, 54, 143],
      accounts: [
        { name: "config", pda: { seeds: [{ kind: "const", value: [99, 111, 110, 102, 105, 103] }, { kind: "account", path: "config.authority", account: "Config" }] } },
        { name: "agent", writable: true, pda: { seeds: [{ kind: "const", value: [97, 103, 101, 110, 116] }, { kind: "account", path: "agent.owner", account: "Agent" }] } },
        { name: "delegation", writable: true, pda: { seeds: [{ kind: "const", value: [100, 101, 108, 101, 103, 97, 116, 105, 111, 110] }, { kind: "account", path: "delegator" }, { kind: "account", path: "agent" }] } },
        { name: "vault", writable: true, pda: { seeds: [{ kind: "const", value: [118, 97, 117, 108, 116] }, { kind: "account", path: "config.authority", account: "Config" }] } },
        { name: "delegator", writable: true, signer: true },
        { name: "system_program", address: "11111111111111111111111111111111" }
      ],
      args: [{ name: "amount", type: "u64" }]
    },
  ],
  accounts: [
    { name: "Agent", discriminator: [47, 166, 112, 147, 155, 197, 86, 7] },
    { name: "Config", discriminator: [155, 12, 170, 224, 30, 250, 204, 130] },
  ],
  types: [
    {
      name: "Agent", type: {
        kind: "struct", fields: [
          { name: "bump", type: "u8" }, { name: "owner", type: "pubkey" },
          { name: "agent_name", type: "string" }, { name: "agent_uri", type: "string" },
          { name: "trust_score", type: "u16" }, { name: "total_trades", type: "u64" },
          { name: "winning_trades", type: "u64" }, { name: "total_pnl", type: "i64" },
          { name: "max_drawdown", type: "u16" }, { name: "recommendation_accuracy", type: "u16" },
          { name: "total_vouched", type: "u64" }, { name: "voucher_count", type: "u64" },
          { name: "total_delegated", type: "u64" }, { name: "is_flagged", type: "bool" },
          { name: "is_active", type: "bool" }, { name: "registered_at", type: "i64" },
          { name: "last_updated", type: "i64" },
        ]
      }
    },
    {
      name: "Config", type: {
        kind: "struct", fields: [
          { name: "bump", type: "u8" }, { name: "vault_bump", type: "u8" },
          { name: "authority", type: "pubkey" }, { name: "is_active", type: "bool" },
          { name: "is_paused", type: "bool" }, { name: "version", type: "u8" },
          { name: "fee_bps", type: "u16" }, { name: "min_stake_amount", type: "u64" },
          { name: "max_trust_score", type: "u16" }, { name: "base_delegation_limit", type: "u64" },
          { name: "total_agents", type: "u64" }, { name: "total_staked", type: "u64" },
        ]
      }
    },
  ],
  errors: [
    { code: 6000, name: "MathOverflow" }, { code: 6001, name: "DivisionByZero" },
    { code: 6002, name: "InsufficientFunds" }, { code: 6003, name: "Unauthorized" },
    { code: 6009, name: "AgentFlagged", msg: "Agent is flagged" },
    { code: 6010, name: "DelegationLimitExceeded", msg: "Delegation limit exceeded" },
  ]
};

// ── HELPERS ────────────────────────────────────────────────
const SCORE_COLOR = (s) => {
  if (s >= 85) return "#00e5a0";
  if (s >= 70) return "#14F195";
  if (s >= 55) return "#facc15";
  if (s >= 40) return "#fb923c";
  return "#ef4444";
};

const TIER = (s) => {
  if (s >= 90) return "AAA";
  if (s >= 80) return "AA";
  if (s >= 70) return "A";
  if (s >= 60) return "BBB";
  if (s >= 50) return "BB";
  if (s >= 40) return "B";
  return "D";
};

const lamportsToSol = (l) => (Number(l) / 1e9).toFixed(4);
const solToLamports = (s) => Math.floor(parseFloat(s) * 1e9);
const shortKey = (pk) => `${pk.toString().slice(0, 4)}...${pk.toString().slice(-4)}`;

// Demo agents for display when no wallet connected
const DEMO_AGENTS = [
  { agent_name: "AlphaVault", owner: "7xKX...mN9p", trust_score: 940, total_trades: 1842, winning_trades: 1445, total_pnl: 342000, max_drawdown: 41, total_vouched: 12400000000, voucher_count: 284, total_delegated: 482000000000, is_flagged: false, is_active: true, registered_at: Date.now() / 1000 - 7776000, isDemo: true },
  { agent_name: "NeuralEdge", owner: "9mKL...xP2q", trust_score: 880, total_trades: 3210, winning_trades: 2285, total_pnl: 227000, max_drawdown: 78, total_vouched: 5800000000, voucher_count: 156, total_delegated: 218000000000, is_flagged: false, is_active: true, registered_at: Date.now() / 1000 - 3888000, isDemo: true },
  { agent_name: "QuietStorm", owner: "3nRT...vB8k", trust_score: 810, total_trades: 920, winning_trades: 605, total_pnl: 181000, max_drawdown: 92, total_vouched: 2100000000, voucher_count: 87, total_delegated: 94000000000, is_flagged: false, is_active: true, registered_at: Date.now() / 1000 - 2592000, isDemo: true },
  { agent_name: "ShadowBot", owner: "1xZZ...kR4m", trust_score: 310, total_trades: 780, winning_trades: 304, total_pnl: -186000, max_drawdown: 412, total_vouched: 40000000, voucher_count: 4, total_delegated: 8000000000, is_flagged: true, is_active: true, registered_at: Date.now() / 1000 - 864000, isDemo: true },
];

// ── COMPONENTS ─────────────────────────────────────────────
function ScoreRing({ score100, size = 60 }) {
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const filled = (score100 / 100) * circ;
  const color = SCORE_COLOR(score100);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a1a2e" strokeWidth={4.5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4.5}
        strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.8s ease" }} />
      <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={size === 60 ? 14 : 20} fontWeight={700}
        style={{ transform: `rotate(90deg)`, transformOrigin: `${size / 2}px ${size / 2}px`, fontFamily: "monospace" }}>
        {score100}
      </text>
    </svg>
  );
}

function TrustBadge({ score100 }) {
  const tier = TIER(score100);
  const color = SCORE_COLOR(score100);
  return (
    <span style={{
      background: `${color}18`, border: `1px solid ${color}55`,
      color, borderRadius: 6, padding: "2px 10px",
      fontSize: 11, fontWeight: 700, fontFamily: "monospace", letterSpacing: 1,
    }}>{tier}</span>
  );
}

function AgentCard({ agent, onSelect }) {
  const score100 = Math.round(agent.trust_score / 10);
  const winRate = agent.total_trades > 0
    ? ((Number(agent.winning_trades) / Number(agent.total_trades)) * 100).toFixed(1)
    : "0.0";
  const pnl = (Number(agent.total_pnl) / 1000).toFixed(1);
  const color = SCORE_COLOR(score100);

  return (
    <div onClick={() => onSelect(agent)}
      style={{
        background: "#0b0b18", border: "1px solid #1a1a30", borderRadius: 18,
        padding: "20px 22px", cursor: "pointer", transition: "all 0.2s",
        position: "relative", overflow: "hidden",
        animation: "fadeUp 0.4s ease both",
      }}
      onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${color}44`; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 28px ${color}12`; }}
      onMouseLeave={e => { e.currentTarget.style.border = "1px solid #1a1a30"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
    >

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
        <ScoreRing score100={score100} size={60} />
        <div style={{ flex: 1 }}>
          <div style={{ color: "#e8e8ff", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{agent.agent_name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <TrustBadge score100={score100} />
            <span style={{ color: "#444", fontSize: 11, fontFamily: "monospace" }}>{typeof agent.owner === "object" ? shortKey(agent.owner) : agent.owner}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "Win Rate", value: `${winRate}%`, color: parseFloat(winRate) > 60 ? "#14F195" : "#fb923c" },
          { label: "PnL", value: `${pnl > 0 ? "+" : ""}${pnl}%`, color: pnl > 0 ? "#14F195" : "#ef4444" },
          { label: "Vouchers", value: agent.voucher_count?.toString() || "0", color: "#c8c8e8" },
        ].map(({ label, value, color: c }) => (
          <div key={label} style={{ background: "#0d0d20", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#444", fontSize: 10, letterSpacing: 1, marginBottom: 3, fontFamily: "monospace" }}>{label}</div>
            <div style={{ color: c, fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <span style={{ color: "#555", fontSize: 12 }}>Staked: <span style={{ color: "#888" }}>{lamportsToSol(agent.total_vouched)} SOL</span></span>
        <span style={{ color: "#555", fontSize: 12 }}>AUM: <span style={{ color: "#c8c8e8" }}>{lamportsToSol(agent.total_delegated)} SOL</span></span>
      </div>
      {(agent.is_flagged || agent.isDemo) && (
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          {agent.isDemo && (
            <span style={{ background: "#9945FF22", border: "1px solid #9945FF44", borderRadius: 6, padding: "2px 10px", color: "#9945FF", fontSize: 10 }}>DEMO</span>
          )}
          {agent.is_flagged && (
            <span style={{ background: "#ef444422", border: "1px solid #ef444455", borderRadius: 6, padding: "2px 10px", color: "#ef4444", fontSize: 10, fontWeight: 700 }}>⚠ FLAGGED</span>
          )}
        </div>
      )}
    </div>
  );
}

function Modal({ agent, wallet, program, configPDA, authorityPubkey, onClose, onSuccess }) {
  const [tab, setTab] = useState("info");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");
  const score100 = Math.round(agent.trust_score / 10);
  const color = SCORE_COLOR(score100);

  const handleDelegate = async () => {
    if (!wallet || !program || agent.isDemo) { setError("Connect your wallet first"); return; }
    setLoading(true); setError(""); setTxSig("");
    try {
      const agentOwner = agent.owner;
      const [agentPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentOwner.toBuffer()], PROGRAM_ID
      );
      const [delegationPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation"), wallet.publicKey.toBuffer(), agentPDA.toBuffer()], PROGRAM_ID
      );
      const [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), authorityPubkey.toBuffer()], PROGRAM_ID
      );
      const lamports = new BN(solToLamports(amount));
      const sig = await program.methods.delegateFunds(lamports).accounts({
        config: configPDA, agent: agentPDA, delegation: delegationPDA,
        vault: vaultPDA, delegator: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();
      setTxSig(sig);
      onSuccess();
    } catch (e) {
      setError(e.message?.slice(0, 120) || "Transaction failed");
    }
    setLoading(false);
  };

  const handleStake = async () => {
    if (!wallet || !program || agent.isDemo) { setError("Connect your wallet first"); return; }
    setLoading(true); setError(""); setTxSig("");
    try {
      const agentOwner = agent.owner;
      const [agentPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentOwner.toBuffer()], PROGRAM_ID
      );
      const [stakePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake"), wallet.publicKey.toBuffer(), agentPDA.toBuffer()], PROGRAM_ID
      );
      const [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), authorityPubkey.toBuffer()], PROGRAM_ID
      );
      const lamports = new BN(solToLamports(amount));
      const sig = await program.methods.stakeVouch(lamports).accounts({
        config: configPDA, agent: agentPDA, stake: stakePDA,
        vault: vaultPDA, voucher: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();
      setTxSig(sig);
      onSuccess();
    } catch (e) {
      setError(e.message?.slice(0, 120) || "Transaction failed");
    }
    setLoading(false);
  };

  const winRate = agent.total_trades > 0
    ? ((Number(agent.winning_trades) / Number(agent.total_trades)) * 100).toFixed(1) : "0.0";

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", backdropFilter: "blur(8px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#09091a", border: `1px solid ${color}33`, borderRadius: 24,
        padding: "28px 32px", maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto",
        boxShadow: `0 24px 80px ${color}15`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <ScoreRing score100={score100} size={72} />
            <div>
              <div style={{ color: "#e8e8ff", fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{agent.agent_name}</div>
              <div style={{ display: "flex", gap: 8 }}><TrustBadge score100={score100} /></div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0d0d20", borderRadius: 10, padding: 4 }}>
          {["info", "delegate", "stake"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
              background: tab === t ? "#1a1a30" : "transparent",
              color: tab === t ? "#e8e8ff" : "#555",
              fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>

        {tab === "info" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "Win Rate", value: `${winRate}%`, color: parseFloat(winRate) > 60 ? "#14F195" : "#fb923c" },
              { label: "Trust Score", value: `${score100}/100`, color },
              { label: "Total Trades", value: Number(agent.total_trades).toLocaleString(), color: "#c8c8e8" },
              { label: "Voucher Count", value: Number(agent.voucher_count).toLocaleString(), color: "#c8c8e8" },
              { label: "Total Vouched", value: `${lamportsToSol(agent.total_vouched)} SOL`, color: "#14F195" },
              { label: "Total Delegated", value: `${lamportsToSol(agent.total_delegated)} SOL`, color: "#14F195" },
              { label: "Status", value: agent.is_flagged ? "⚠ Flagged" : "✓ Active", color: agent.is_flagged ? "#ef4444" : "#14F195" },
              { label: "Registered", value: new Date(Number(agent.registered_at) * 1000).toLocaleDateString(), color: "#888" },
            ].map(({ label, value, color: c }) => (
              <div key={label} style={{ background: "#0d0d20", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ color: "#444", fontSize: 10, letterSpacing: 1.5, marginBottom: 4, fontFamily: "monospace" }}>{label.toUpperCase()}</div>
                <div style={{ color: c, fontWeight: 700, fontSize: 14, fontFamily: "monospace" }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "delegate" && (
          <div>
            <div style={{ color: "#888", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
              Delegate SOL to this agent. Max delegation = trust score × base limit.
              {agent.is_flagged && <span style={{ color: "#ef4444", display: "block", marginTop: 8 }}>⚠ This agent is flagged — delegation is blocked onchain.</span>}
            </div>
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount in SOL (e.g. 0.1)"
              style={{ width: "100%", background: "#07070f", border: "1px solid #1a1a30", borderRadius: 10, padding: "12px 14px", color: "#e8e8ff", fontSize: 14, fontFamily: "monospace", marginBottom: 12 }} />
            {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12, background: "#ef444411", padding: "8px 12px", borderRadius: 8 }}>{error}</div>}
            {txSig && (
              <div style={{ color: "#14F195", fontSize: 11, marginBottom: 12, background: "#14F19511", padding: "8px 12px", borderRadius: 8, fontFamily: "monospace", wordBreak: "break-all" }}>
                ✓ Success! <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank" rel="noreferrer" style={{ color: "#14F195" }}>View on Explorer ↗</a>
              </div>
            )}
            <button onClick={handleDelegate} disabled={!amount || loading}
              style={{ width: "100%", padding: "13px 0", background: amount && !loading ? `linear-gradient(135deg, ${color}, #9945FF)` : "#1a1a30", border: "none", borderRadius: 12, color: amount && !loading ? "#000" : "#444", fontWeight: 700, fontSize: 15, cursor: amount && !loading ? "pointer" : "default", fontFamily: "inherit" }}>
              {loading ? "Signing..." : "Delegate SOL →"}
            </button>
          </div>
        )}

        {tab === "stake" && (
          <div>
            <div style={{ color: "#888", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
              Stake SOL to vouch for this agent. Increases their trust score and earns you platform reputation.
            </div>
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount in SOL (min 0.1 SOL)"
              style={{ width: "100%", background: "#07070f", border: "1px solid #1a1a30", borderRadius: 10, padding: "12px 14px", color: "#e8e8ff", fontSize: 14, fontFamily: "monospace", marginBottom: 12 }} />
            {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12, background: "#ef444411", padding: "8px 12px", borderRadius: 8 }}>{error}</div>}
            {txSig && (
              <div style={{ color: "#14F195", fontSize: 11, marginBottom: 12, background: "#14F19511", padding: "8px 12px", borderRadius: 8, fontFamily: "monospace", wordBreak: "break-all" }}>
                ✓ Staked! <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank" rel="noreferrer" style={{ color: "#14F195" }}>View on Explorer ↗</a>
              </div>
            )}
            <button onClick={handleStake} disabled={!amount || loading}
              style={{ width: "100%", padding: "13px 0", background: amount && !loading ? "linear-gradient(135deg, #14F195, #00e5a0)" : "#1a1a30", border: "none", borderRadius: 12, color: amount && !loading ? "#000" : "#444", fontWeight: 700, fontSize: 15, cursor: amount && !loading ? "pointer" : "default", fontFamily: "inherit" }}>
              {loading ? "Signing..." : "Stake & Vouch →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RegisterModal({ wallet, program, configPDA, onClose, onSuccess }) {
  const [name, setName] = useState("");
  const [uri, setUri] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [txSig, setTxSig] = useState("");

  const handleRegister = async () => {
    if (!wallet || !program) { setError("Connect wallet first"); return; }
    if (!name.trim()) { setError("Agent name required"); return; }
    setLoading(true); setError(""); setTxSig("");
    try {
      const [agentPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), wallet.publicKey.toBuffer()], PROGRAM_ID
      );
      const sig = await program.methods.registerAgent(name.trim(), uri.trim() || "https://marketplace-of-trust.sol").accounts({
        config: configPDA, agent: agentPDA, owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();
      setTxSig(sig);
      setTimeout(() => { onSuccess(); onClose(); }, 2000);
    } catch (e) {
      setError(e.message?.slice(0, 120) || "Registration failed");
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", backdropFilter: "blur(8px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#09091a", border: "1px solid #9945FF44", borderRadius: 24, padding: "28px 32px", maxWidth: 460, width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ color: "#e8e8ff", fontWeight: 800, fontSize: 20 }}>Register Agent</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ color: "#555", fontSize: 12, marginBottom: 16, fontFamily: "monospace" }}>Your wallet: {wallet?.publicKey ? shortKey(wallet.publicKey) : "—"}</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Agent Name (e.g. AlphaVault)"
          style={{ width: "100%", background: "#07070f", border: "1px solid #1a1a30", borderRadius: 10, padding: "12px 14px", color: "#e8e8ff", fontSize: 14, fontFamily: "inherit", marginBottom: 10 }} />
        <input value={uri} onChange={e => setUri(e.target.value)} placeholder="Agent URI / website (optional)"
          style={{ width: "100%", background: "#07070f", border: "1px solid #1a1a30", borderRadius: 10, padding: "12px 14px", color: "#e8e8ff", fontSize: 14, fontFamily: "inherit", marginBottom: 16 }} />
        {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12, background: "#ef444411", padding: "8px 12px", borderRadius: 8 }}>{error}</div>}
        {txSig && <div style={{ color: "#14F195", fontSize: 11, marginBottom: 12, background: "#14F19511", padding: "8px 12px", borderRadius: 8, fontFamily: "monospace" }}>✓ Registered onchain!</div>}
        <button onClick={handleRegister} disabled={loading || !name.trim()}
          style={{ width: "100%", padding: "13px 0", background: name.trim() && !loading ? "linear-gradient(135deg, #9945FF, #14F195)" : "#1a1a30", border: "none", borderRadius: 12, color: name.trim() && !loading ? "#000" : "#444", fontWeight: 700, fontSize: 15, cursor: name.trim() && !loading ? "pointer" : "default", fontFamily: "inherit" }}>
          {loading ? "Registering..." : "Register Agent →"}
        </button>
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────
export default function App() {
  const [wallet, setWallet] = useState(null);
  const [program, setProgram] = useState(null);
  const [configPDA, setConfigPDA] = useState(null);
  const [authorityPubkey, setAuthorityPubkey] = useState(null);
  const [agents, setAgents] = useState(DEMO_AGENTS);
  const [selected, setSelected] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("score");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Connect Phantom
  const connectWallet = async () => {
    try {
      const { solana } = window;
      if (!solana?.isPhantom) { alert("Install Phantom wallet from phantom.app"); return; }
      const resp = await solana.connect();
      const pubkey = resp.publicKey;

      const provider = new AnchorProvider(CONNECTION, { publicKey: pubkey, signTransaction: async (tx) => { const signed = await solana.signTransaction(tx); return signed; }, signAllTransactions: async (txs) => { const signed = await solana.signAllTransactions(txs); return signed; } }, { commitment: "confirmed" });

      const prog = new Program(IDL, provider);
      setWallet({ publicKey: pubkey });
      setProgram(prog);
      showToast(`Connected: ${shortKey(pubkey)}`);
    } catch (e) {
      showToast("Connection failed: " + e.message?.slice(0, 60));
    }
  };

  // Fetch real agents from chain
  const fetchAgents = useCallback(async () => {
    if (!program) return;
    setLoading(true);
    try {
      const allAgents = await program.account.agent.all();

      // Get config to find authority
      const allConfigs = await program.account.config.all();
      if (allConfigs.length > 0) {
        const cfg = allConfigs[0];
        setAuthorityPubkey(cfg.account.authority);
        const [cPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("config"), cfg.account.authority.toBuffer()], PROGRAM_ID
        );
        setConfigPDA(cPDA);
      }

      if (allAgents.length > 0) {
        setAgents(allAgents.map(a => ({ ...a.account, publicKey: a.publicKey })));
      } else {
        setAgents(DEMO_AGENTS);
      }
    } catch (e) {
      console.error("Fetch error:", e);
      setAgents(DEMO_AGENTS);
    }
    setLoading(false);
  }, [program]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // Auto-connect if already authorized
  useEffect(() => {
    const { solana } = window;
    if (solana?.isPhantom && solana.isConnected) connectWallet();
  }, []);

  const filtered = agents
    .filter(a => {
      const score = Math.round(a.trust_score / 10);
      if (filter === "verified") return !a.is_flagged && a.is_active;
      if (filter === "aaa") return score >= 70;
      if (filter === "risky") return score < 60;
      return true;
    })
    .sort((a, b) => {
      if (sort === "score") return b.trust_score - a.trust_score;
      if (sort === "aum") return Number(b.total_delegated) - Number(a.total_delegated);
      if (sort === "staked") return Number(b.total_vouched) - Number(a.total_vouched);
      return 0;
    });

  return (
    <div style={{ minHeight: "100vh", background: "#06060f", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-16px)} to{opacity:1;transform:translateY(0)} }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #1a1a30; border-radius: 2px; }
        input { outline: none; }
        input::placeholder { color: #333; }
        .mot-header { padding: 12px 16px !important; }
        .mot-header-title { font-size: 15px !important; }
        .mot-header-sub { display: none !important; }
        .mot-register-btn { display: none !important; }
        .mot-connect-btn { font-size: 12px !important; padding: 7px 12px !important; }
        .mot-stats { padding: 12px 16px 0 !important; display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 8px !important; }
        .mot-filters { padding: 12px 16px !important; flex-direction: column !important; gap: 8px !important; }
        .mot-filter-btns { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; }
        .mot-sort-row { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; margin-left: 0 !important; }
        .mot-grid { padding: 0 16px 32px !important; grid-template-columns: 1fr !important; }
        .mot-banner { margin: 0 16px 12px !important; }
        @media (min-width: 640px) {
          .mot-header { padding: 18px 32px !important; }
          .mot-header-title { font-size: 18px !important; }
          .mot-header-sub { display: block !important; }
          .mot-register-btn { display: block !important; }
          .mot-connect-btn { font-size: 13px !important; padding: 8px 18px !important; }
          .mot-stats { padding: 20px 32px 0 !important; display: flex !important; gap: 16px !important; }
          .mot-filters { padding: 20px 32px !important; flex-direction: row !important; }
          .mot-sort-row { margin-left: auto !important; }
          .mot-grid { padding: 0 32px 40px !important; grid-template-columns: repeat(auto-fill, minmax(300px,1fr)) !important; }
          .mot-banner { margin: 0 32px 24px !important; }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, background: "#0d1f14", border: "1px solid #14F19544", borderRadius: 12, padding: "12px 18px", color: "#14F195", fontSize: 13, fontFamily: "monospace", zIndex: 999, animation: "slideIn 0.3s ease" }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="mot-header" style={{ borderBottom: "1px solid #111128", padding: "18px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "#06060fee", backdropFilter: "blur(16px)", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #00e5a0, #9945FF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>⚖</div>
          <div>
            <div className="mot-header-title" style={{ color: "#e8e8ff", fontWeight: 800, fontSize: 18, letterSpacing: -0.5 }}>Marketplace of Trust</div>
            <div className="mot-header-sub" style={{ color: "#444", fontSize: 11 }}>Solana Devnet · Program: FWe2...Yoza</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {wallet && (
            <button className="mot-register-btn" onClick={() => setShowRegister(true)} style={{ padding: "8px 14px", background: "transparent", border: "1px solid #9945FF55", borderRadius: 10, color: "#9945FF", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
              + Register
            </button>
          )}
          <button className="mot-connect-btn" onClick={wallet ? fetchAgents : connectWallet} style={{ padding: "8px 16px", background: wallet ? "transparent" : "linear-gradient(135deg, #9945FF, #7a30d4)", border: wallet ? "1px solid #00e5a044" : "none", borderRadius: 10, color: wallet ? "#00e5a0" : "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            {wallet ? `✓ ${shortKey(wallet.publicKey)}` : "Connect Phantom"}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mot-stats" style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 32px 0", display: "flex", gap: 16 }}>
        {[
          { label: "Agents", value: agents.length },
          { label: "Network", value: "Devnet" },
          { label: "Program", value: "Live ✓" },
          { label: "Contract", value: "FWe2...Yoza" },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "#0b0b18", border: "1px solid #1a1a28", borderRadius: 12, padding: "12px 18px", flex: 1 }}>
            <div style={{ color: "#444", fontSize: 10, letterSpacing: 1.5, marginBottom: 4, fontFamily: "monospace" }}>{label.toUpperCase()}</div>
            <div style={{ color: "#00e5a0", fontWeight: 700, fontSize: 16, fontFamily: "monospace" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mot-filters" style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 32px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div className="mot-filter-btns" style={{ display: "flex", gap: 6 }}>
          {[
            { k: "all", label: "All Agents" },
            { k: "verified", label: "✓ Active" },
            { k: "aaa", label: "Investment Grade" },
            { k: "risky", label: "High Risk" },
          ].map(({ k, label }) => (
            <button key={k} onClick={() => setFilter(k)} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: filter === k ? "#00e5a022" : "transparent", border: filter === k ? "1px solid #00e5a044" : "1px solid #1a1a30", color: filter === k ? "#00e5a0" : "#555", cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
          ))}
        </div>
        <div className="mot-sort-row" style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "#444", fontSize: 12 }}>Sort:</span>
          {[{ k: "score", label: "Trust Score" }, { k: "aum", label: "AUM" }, { k: "staked", label: "Staked" }].map(({ k, label }) => (
            <button key={k} onClick={() => setSort(k)} style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, background: sort === k ? "#1a1a30" : "transparent", border: "1px solid " + (sort === k ? "#333" : "transparent"), color: sort === k ? "#c8c8e8" : "#555", cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
          ))}
        </div>
        {wallet && (
          <button onClick={fetchAgents} disabled={loading} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, background: "transparent", border: "1px solid #1a1a30", color: loading ? "#333" : "#555", cursor: loading ? "default" : "pointer", fontFamily: "inherit" }}>
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
        )}
      </div>

      {/* Agent Grid */}
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {!wallet && (
          <div className="mot-banner" style={{ background: "#0b0b18", border: "1px solid #9945FF33", borderRadius: 14, padding: "14px 20px", marginBottom: 16, margin: "0 32px 24px", color: "#888", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>Showing demo data — <span style={{ color: "#9945FF" }}>connect Phantom</span> to see live onchain agents</span>
            <button onClick={connectWallet} style={{ background: "linear-gradient(135deg, #9945FF, #7a30d4)", border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Connect →</button>
          </div>
        )}
        <div className="mot-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, padding: "0 32px 40px" }}>
          {filtered.map((agent, i) => (
            <div key={i} style={{ animationDelay: `${i * 0.06}s` }}>
              <AgentCard agent={agent} onSelect={setSelected} />
            </div>
          ))}
        </div>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#444", padding: "60px 0", fontSize: 15 }}>No agents match this filter.</div>
        )}
        <div style={{ marginTop: 32, padding: "16px 20px", background: "#0a0a1a", borderRadius: 12, border: "1px solid #1a1a28" }}>
          <div style={{ color: "#2a2a3e", fontSize: 11, fontFamily: "monospace" }}>
            ⚠ Devnet only · Program: FWe29tk47GWzTXJDBQTNU85bHR3wg6wbQ1XbLuYPoyza · Not financial advice
          </div>
        </div>
      </div>

      {/* Modals */}
      {selected && (
        <Modal agent={selected} wallet={wallet} program={program} configPDA={configPDA} authorityPubkey={authorityPubkey}
          onClose={() => setSelected(null)} onSuccess={() => { showToast("Transaction confirmed! ✓"); fetchAgents(); }} />
      )}
      {showRegister && (
        <RegisterModal wallet={wallet} program={program} configPDA={configPDA}
          onClose={() => setShowRegister(false)} onSuccess={() => { showToast("Agent registered! ✓"); fetchAgents(); }} />
      )}
    </div>
  );
}