import type { Metadata } from "next";
import {
  ContactCard,
  LegalHeader,
  LegalSection,
  List,
  P,
  Strong,
} from "../_components";

export const metadata: Metadata = {
  title: "Política de Cookies — Disparador.ai",
  description:
    "Como o Disparador.ai usa cookies e tecnologias similares: cookies essenciais de sessão e analytics.",
};

export default function CookiesPage() {
  return (
    <article>
      <LegalHeader
        eyebrow="Cookies"
        title="Política de Cookies"
        intro="Esta Política explica como o Disparador.ai usa cookies e tecnologias similares para manter você conectado e entender, de forma agregada, como a plataforma é utilizada."
      />

      <LegalSection n="1" title="O que são cookies">
        <P>
          Cookies são pequenos arquivos armazenados no seu navegador quando você acessa um
          site. Eles permitem que o serviço funcione corretamente, lembre de preferências
          e colete métricas de uso. Tecnologias similares (como armazenamento local)
          podem ser usadas com as mesmas finalidades.
        </P>
      </LegalSection>

      <LegalSection n="2" title="Cookies que utilizamos">
        <List
          items={[
            <>
              <Strong>Cookie de sessão (essencial):</Strong> mantém você autenticado
              enquanto usa a plataforma. Sem ele, não é possível entrar nem manter o
              acesso à sua conta. Por ser estritamente necessário ao funcionamento do
              serviço, não depende de consentimento.
            </>,
            <>
              <Strong>Analytics (PostHog), se ativo:</Strong> coleta métricas agregadas de
              uso — páginas visitadas, cliques e fluxos — para entendermos o comportamento
              geral e melhorarmos o produto. Esses dados nos ajudam a priorizar melhorias.
            </>,
          ]}
        />
        <P>
          O analytics só é carregado quando a integração estiver configurada e ativa no
          ambiente. Quando inativo, nenhum cookie de medição é definido.
        </P>
      </LegalSection>

      <LegalSection n="3" title="Como gerenciar cookies">
        <P>
          Você pode bloquear ou apagar cookies nas configurações do seu navegador. Note
          que, ao bloquear o <Strong>cookie de sessão essencial</Strong>, o acesso à sua
          conta deixará de funcionar. Cookies de analytics, quando presentes, podem ser
          bloqueados sem impacto nas funcionalidades principais.
        </P>
      </LegalSection>

      <LegalSection n="4" title="Mais informações">
        <P>
          O tratamento dos dados coletados por cookies segue a nossa{" "}
          <a href="/privacidade" className="font-semibold text-brand-600 hover:text-brand-500">
            Política de Privacidade
          </a>
          . Em caso de dúvidas, fale com nosso Encarregado de Dados:
        </P>
        <ContactCard label="Encarregado de Dados (DPO)" email="dpo@disparador.ai" />
      </LegalSection>
    </article>
  );
}
