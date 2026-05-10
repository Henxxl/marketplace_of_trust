import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Workspace } from "../target/types/workspace";
import { expect } from "chai";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

describe("workspace", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.workspace as Program<Workspace>;

  let authority: Keypair;
  let agentOwner: Keypair;
  let voucher1: Keypair;
  let delegator1: Keypair;
  let treasury: Keypair;

  let configPDA: PublicKey;
  let vaultPDA: PublicKey;
  let agentPDA: PublicKey;
  let stakePDA: PublicKey;
  let delegationPDA: PublicKey;

  const FEE_BPS = 250;
  const MIN_STAKE = new BN(100_000_000); // 0.1 SOL
  const MAX_TRUST_SCORE = 10000;
  const BASE_DELEGATION_LIMIT = new BN(1_000_000_000); // 1 SOL per score point

  before(async () => {
    authority = Keypair.generate();
    agentOwner = Keypair.generate();
    voucher1 = Keypair.generate();
    delegator1 = Keypair.generate();
    treasury = Keypair.generate();

    // Fund all accounts with 100 SOL
    const accounts = [authority, agentOwner, voucher1, delegator1, treasury];
    for (const account of accounts) {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          account.publicKey,
          100 * LAMPORTS_PER_SOL
        )
      );
    }

    [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), authority.publicKey.toBuffer()],
      program.programId
    );

    [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), authority.publicKey.toBuffer()],
      program.programId
    );

    [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentOwner.publicKey.toBuffer()],
      program.programId
    );

    [stakePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("stake"),
        voucher1.publicKey.toBuffer(),
        agentPDA.toBuffer(),
      ],
      program.programId
    );

    [delegationPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("delegation"),
        delegator1.publicKey.toBuffer(),
        agentPDA.toBuffer(),
      ],
      program.programId
    );
  });

  it("Initialize Config", async () => {
    await program.methods
      .initializeConfig(FEE_BPS, MIN_STAKE, MAX_TRUST_SCORE, BASE_DELEGATION_LIMIT)
      .accounts({
        config: configPDA,
        vault: vaultPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const config = await program.account.config.fetch(configPDA);
    expect(config.isActive).to.be.true;
    expect(config.isPaused).to.be.false;
    expect(Number(config.feeBps)).to.equal(FEE_BPS);
    expect(Number(config.minStakeAmount.toString())).to.equal(100_000_000);
    expect(Number(config.maxTrustScore)).to.equal(MAX_TRUST_SCORE);
    expect(Number(config.totalAgents.toString())).to.equal(0);
    expect(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  it("Register Agent", async () => {
    await program.methods
      .registerAgent("AlphaTraderAI", "https://agent.ai/alpha")
      .accounts({
        config: configPDA,
        agent: agentPDA,
        owner: agentOwner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([agentOwner])
      .rpc();

    const agent = await program.account.agent.fetch(agentPDA);
    expect(agent.agentName).to.equal("AlphaTraderAI");
    expect(agent.agentUri).to.equal("https://agent.ai/alpha");
    expect(Number(agent.trustScore)).to.equal(0);
    expect(agent.isActive).to.be.true;
    expect(agent.isFlagged).to.be.false;
    expect(agent.owner.toBase58()).to.equal(agentOwner.publicKey.toBase58());

    const config = await program.account.config.fetch(configPDA);
    expect(Number(config.totalAgents.toString())).to.equal(1);
  });

  it("Update Trust Score - good performance", async () => {
    await program.methods
      .updateTrustScore(
        new BN(100),   // total_trades
        new BN(75),    // winning_trades (75% win rate)
        new BN(500),   // total_pnl (positive)
        500,           // max_drawdown (5%)
        8000,          // recommendation_accuracy (80%)
        false          // not flagged
      )
      .accounts({
        config: configPDA,
        agent: agentPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const agent = await program.account.agent.fetch(agentPDA);
    expect(Number(agent.trustScore)).to.be.greaterThan(0);
    expect(Number(agent.totalTrades.toString())).to.equal(100);
    expect(Number(agent.winningTrades.toString())).to.equal(75);
    expect(Number(agent.totalPnl.toString())).to.equal(500);
    expect(agent.isFlagged).to.be.false;
  });

  it("Stake Vouch for Agent", async () => {
    const stakeAmount = new BN(500_000_000); // 0.5 SOL

    const vaultBalanceBefore = await provider.connection.getBalance(vaultPDA);

    await program.methods
      .stakeVouch(stakeAmount)
      .accounts({
        config: configPDA,
        agent: agentPDA,
        stake: stakePDA,
        vault: vaultPDA,
        voucher: voucher1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([voucher1])
      .rpc();

    const stake = await program.account.stake.fetch(stakePDA);
    expect(Number(stake.amount.toString())).to.equal(500_000_000);
    expect(stake.voucher.toBase58()).to.equal(voucher1.publicKey.toBase58());

    const agent = await program.account.agent.fetch(agentPDA);
    expect(Number(agent.totalVouched.toString())).to.equal(500_000_000);
    expect(Number(agent.voucherCount.toString())).to.equal(1);

    const vaultBalanceAfter = await provider.connection.getBalance(vaultPDA);
    expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(500_000_000);

    const config = await program.account.config.fetch(configPDA);
    expect(Number(config.totalStaked.toString())).to.equal(500_000_000);
  });

  it("Update Trust Score - with vouch bonus", async () => {
    await program.methods
      .updateTrustScore(
        new BN(200),
        new BN(160),   // 80% win rate
        new BN(1000),
        300,           // 3% drawdown
        9000,          // 90% accuracy
        false
      )
      .accounts({
        config: configPDA,
        agent: agentPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const agent = await program.account.agent.fetch(agentPDA);
    expect(Number(agent.trustScore)).to.be.greaterThan(0);
    expect(Number(agent.totalTrades.toString())).to.equal(200);
  });

  it("Delegate Funds to Agent", async () => {
    const agent = await program.account.agent.fetch(agentPDA);
    const delegateAmount = new BN(1_000_000_000); // 1 SOL (well within trust score limit)

    await program.methods
      .delegateFunds(delegateAmount)
      .accounts({
        config: configPDA,
        agent: agentPDA,
        delegation: delegationPDA,
        vault: vaultPDA,
        delegator: delegator1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([delegator1])
      .rpc();

    const delegation = await program.account.delegation.fetch(delegationPDA);
    expect(Number(delegation.amount.toString())).to.equal(Number(delegateAmount.toString()));
    expect(delegation.delegator.toBase58()).to.equal(delegator1.publicKey.toBase58());

    const agentAfter = await program.account.agent.fetch(agentPDA);
    expect(Number(agentAfter.totalDelegated.toString())).to.equal(Number(delegateAmount.toString()));
  });

  it("Withdraw Delegation", async () => {
    const delegationBefore = await program.account.delegation.fetch(delegationPDA);
    const withdrawAmount = new BN(delegationBefore.amount.toString()).div(new BN(2));

    const delegatorBefore = await provider.connection.getBalance(delegator1.publicKey);

    await program.methods
      .withdrawDelegation(withdrawAmount)
      .accounts({
        config: configPDA,
        agent: agentPDA,
        delegation: delegationPDA,
        vault: vaultPDA,
        delegator: delegator1.publicKey,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([delegator1])
      .rpc();

    const delegationAfter = await program.account.delegation.fetch(delegationPDA);
    const expectedRemaining = Number(delegationBefore.amount.toString()) - Number(withdrawAmount.toString());
    expect(Number(delegationAfter.amount.toString())).to.equal(expectedRemaining);

    const delegatorAfter = await provider.connection.getBalance(delegator1.publicKey);
    expect(delegatorAfter).to.be.greaterThan(delegatorBefore - 100_000);
  });

  it("Unstake Vouch", async () => {
    const unstakeAmount = new BN(200_000_000); // 0.2 SOL

    const voucherBefore = await provider.connection.getBalance(voucher1.publicKey);

    await program.methods
      .unstakeVouch(unstakeAmount)
      .accounts({
        config: configPDA,
        agent: agentPDA,
        stake: stakePDA,
        vault: vaultPDA,
        voucher: voucher1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([voucher1])
      .rpc();

    const stake = await program.account.stake.fetch(stakePDA);
    expect(Number(stake.amount.toString())).to.equal(300_000_000); // 0.5 - 0.2 = 0.3 SOL

    const agent = await program.account.agent.fetch(agentPDA);
    expect(Number(agent.totalVouched.toString())).to.equal(300_000_000);

    const voucherAfter = await provider.connection.getBalance(voucher1.publicKey);
    expect(voucherAfter).to.be.greaterThan(voucherBefore);
  });

  it("Toggle Pause", async () => {
    await program.methods
      .togglePause()
      .accounts({
        config: configPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const config = await program.account.config.fetch(configPDA);
    expect(config.isPaused).to.be.true;
  });

  it("Reject operations when paused", async () => {
    const agentOwner2 = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(agentOwner2.publicKey, 10 * LAMPORTS_PER_SOL)
    );

    const [agent2PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentOwner2.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .registerAgent("PausedAgent", "https://paused.ai")
        .accounts({
          config: configPDA,
          agent: agent2PDA,
          owner: agentOwner2.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([agentOwner2])
        .rpc();
      expect.fail("Should have failed when paused");
    } catch (error) {
      expect(error.message).to.include("Config is inactive or paused");
    }
  });

  it("Unpause and resume operations", async () => {
    await program.methods
      .togglePause()
      .accounts({
        config: configPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const config = await program.account.config.fetch(configPDA);
    expect(config.isPaused).to.be.false;
  });

  it("Flagged agent blocks delegation", async () => {
    await program.methods
      .updateTrustScore(
        new BN(200),
        new BN(160),
        new BN(1000),
        300,
        9000,
        true // flagged!
      )
      .accounts({
        config: configPDA,
        agent: agentPDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const agent = await program.account.agent.fetch(agentPDA);
    expect(agent.isFlagged).to.be.true;
    expect(Number(agent.trustScore)).to.be.greaterThan(0); // score halved but >0

    const delegator2 = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(delegator2.publicKey, 10 * LAMPORTS_PER_SOL)
    );

    const [delegation2PDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("delegation"),
        delegator2.publicKey.toBuffer(),
        agentPDA.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .delegateFunds(new BN(100_000_000))
        .accounts({
          config: configPDA,
          agent: agentPDA,
          delegation: delegation2PDA,
          vault: vaultPDA,
          delegator: delegator2.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([delegator2])
        .rpc();
      expect.fail("Should have failed for flagged agent");
    } catch (error) {
      expect(error.message).to.include("Agent is flagged");
    }
  });

  it("Unauthorized authority rejected", async () => {
    const fakeAuth = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(fakeAuth.publicKey, 10 * LAMPORTS_PER_SOL)
    );

    try {
      await program.methods
        .updateTrustScore(new BN(1), new BN(1), new BN(1), 0, 0, false)
        .accounts({
          config: configPDA,
          agent: agentPDA,
          authority: fakeAuth.publicKey,
        })
        .signers([fakeAuth])
        .rpc();
      expect.fail("Should reject unauthorized authority");
    } catch (error) {
      expect(error.message).to.include("A seeds constraint was violated");
    }
  });
});