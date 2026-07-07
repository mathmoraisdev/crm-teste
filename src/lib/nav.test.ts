import { describe, it, expect } from "vitest";
import { buildNav, moduleVisibleFor, type NavCtx } from "./nav";

const base: NavCtx = { isAdmin: false, isAccountAdmin: false, category: "beleza" };

describe("buildNav", () => {
  it("agrupa na nova estrutura (Operação/Clientes/Catálogo/Financeiro/Conta)", () => {
    const titles = buildNav(base).map((g) => g.title);
    expect(titles).toEqual(["Operação", "Clientes", "Catálogo & Estoque", "Financeiro", "Conta"]);
  });
  it("Operação tem Painel, Atendimento, Agenda, Caixa", () => {
    const op = buildNav(base).find((g) => g.title === "Operação")!;
    expect(op.items.map((i) => i.href)).toEqual(["/painel", "/inbox", "/agenda", "/caixa"]);
  });
  it("Administração (billing SaaS) só aparece para admin da plataforma", () => {
    const semAdmin = buildNav(base).flatMap((g) => g.items).some((i) => i.href === "/financeiro");
    expect(semAdmin).toBe(false);
    const comAdmin = buildNav({ ...base, isAdmin: true }).flatMap((g) => g.items)
      .find((i) => i.href === "/financeiro");
    expect(comAdmin?.label).toBe("Administração");
  });
  it("Equipe só para admin da conta", () => {
    expect(buildNav(base).flatMap((g) => g.items).some((i) => i.href === "/equipe")).toBe(false);
    expect(buildNav({ ...base, isAccountAdmin: true }).flatMap((g) => g.items)
      .some((i) => i.href === "/equipe")).toBe(true);
  });
  it("Produção (cozinha) na Operação só para ramos de alimentação", () => {
    const opAlim = buildNav({ ...base, category: "alimentacao" }).find((g) => g.title === "Operação")!;
    expect(opAlim.items.some((i) => i.href === "/producao")).toBe(true);
    const opBeleza = buildNav(base).find((g) => g.title === "Operação")!;
    expect(opBeleza.items.some((i) => i.href === "/producao")).toBe(false);
  });
});

describe("moduleVisibleFor", () => {
  it("Produção só em alimentação", () => {
    expect(moduleVisibleFor("alimentacao", "producao")).toBe(true);
    expect(moduleVisibleFor("beleza", "producao")).toBe(false);
  });
  it("Agenda faz sentido em beleza/saúde, não em varejo/alimentação", () => {
    expect(moduleVisibleFor("beleza", "agenda")).toBe(true);
    expect(moduleVisibleFor("varejo", "agenda")).toBe(false);
  });
  it("Estoque some em serviços sem produto (ex.: servicos-pro)", () => {
    expect(moduleVisibleFor("varejo", "estoque")).toBe(true);
    expect(moduleVisibleFor("servicos-pro", "estoque")).toBe(false);
  });
  it("categoria desconhecida/null → mostra tudo (fail-open)", () => {
    expect(moduleVisibleFor(null, "producao")).toBe(true);
  });
});
