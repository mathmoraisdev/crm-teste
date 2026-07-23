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
  title: "Política de Privacidade — Disparador.ai",
  description:
    "Como o Disparador.ai coleta, usa, compartilha e protege seus dados pessoais, em conformidade com a LGPD.",
};

export default function PrivacidadePage() {
  return (
    <article>
      <LegalHeader
        eyebrow="Privacidade"
        title="Política de Privacidade"
        intro="Esta Política explica como o Disparador.ai trata os dados pessoais de quem usa a plataforma e dos contatos importados por seus usuários, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD)."
      />

      <LegalSection n="1" title="Quem somos">
        <P>
          O <Strong>Disparador.ai</Strong> é uma plataforma de disparo de mensagens em
          massa no WhatsApp com CRM e recursos de inteligência artificial. Para fins da
          LGPD, atuamos como <Strong>controlador</Strong> dos dados de conta e como{" "}
          <Strong>operador</Strong> dos dados que você, usuário, importa e processa na
          plataforma — caso em que você é o controlador desses dados.
        </P>
      </LegalSection>

      <LegalSection n="2" title="Dados que coletamos">
        <P>Coletamos diferentes categorias de dados conforme o uso da plataforma:</P>
        <List
          items={[
            <>
              <Strong>Dados de conta:</Strong> nome, e-mail e número de WhatsApp que você
              informa ao se cadastrar e usar o serviço.
            </>,
            <>
              <Strong>Leads importados:</Strong> nome, telefone e e-mail dos contatos que
              você adiciona manualmente ou importa por CSV para suas campanhas.
            </>,
            <>
              <Strong>Conteúdo de conversas:</Strong> o conteúdo das mensagens trocadas
              com seus leads, que pode ser <Strong>processado por inteligência
              artificial</Strong> para classificar, resumir e sugerir respostas.
            </>,
            <>
              <Strong>Dados de uso e técnicos:</Strong> registros de acesso, endereço IP,
              tipo de dispositivo e navegador, e métricas de envio (entregas, respostas,
              opt-outs), usados para operar e proteger o serviço.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection n="3" title="Para que usamos os dados (finalidades)">
        <List
          items={[
            "Criar e manter sua conta, autenticar acessos e dar suporte.",
            "Permitir o envio de campanhas e o gerenciamento de leads no CRM.",
            "Processar conteúdo de conversas com IA para organizar leads, sugerir respostas e gerar resumos.",
            "Enviar comunicações operacionais (verificação de e-mail, recuperação de senha, avisos de serviço).",
            "Monitorar o uso, prevenir abusos, fraudes e bloqueios, e melhorar a plataforma.",
            "Cumprir obrigações legais e regulatórias.",
          ]}
        />
      </LegalSection>

      <LegalSection n="4" title="Base legal (LGPD)">
        <P>O tratamento dos dados se apoia nas seguintes hipóteses legais do art. 7º da LGPD:</P>
        <List
          items={[
            <>
              <Strong>Execução de contrato</Strong> (art. 7º, V): para fornecer o serviço
              contratado, incluindo dados de conta e o processamento de leads e conversas
              que você opera.
            </>,
            <>
              <Strong>Legítimo interesse</Strong> (art. 7º, IX): para segurança,
              prevenção de fraude e bloqueios, e melhoria do produto, sempre respeitando
              seus direitos e expectativas.
            </>,
            <>
              <Strong>Cumprimento de obrigação legal</Strong> (art. 7º, II): quando a lei
              exigir a retenção ou o fornecimento de dados.
            </>,
            <>
              <Strong>Consentimento</Strong> (art. 7º, I): quando aplicável, por exemplo
              para comunicações de marketing opcionais.
            </>,
          ]}
        />
        <P>
          Como controlador dos leads que importa, é sua responsabilidade ter base legal
          adequada (em geral o consentimento dos contatos) para tratá-los e enviar
          mensagens. Veja também nossos{" "}
          <a href="/termos" className="font-semibold text-brand-600 hover:text-brand-500">
            Termos de Uso
          </a>
          .
        </P>
      </LegalSection>

      <LegalSection n="5" title="Compartilhamento de dados">
        <P>
          Não vendemos seus dados. Compartilhamos apenas o necessário para operar o
          serviço, com os seguintes tipos de parceiros:
        </P>
        <List
          items={[
            <>
              <Strong>OpenAI:</Strong> processamento de conteúdo de conversas por
              inteligência artificial (classificação, resumo e sugestão de respostas).
            </>,
            <>
              <Strong>WhatsApp / Meta:</Strong> envio e recebimento das mensagens através
              da infraestrutura do WhatsApp.
            </>,
            <>
              <Strong>Provedores de infraestrutura:</Strong> hospedagem, banco de dados,
              envio de e-mails transacionais e monitoramento, contratados como operadores
              sob obrigações de confidencialidade e segurança.
            </>,
            <>
              <Strong>Autoridades:</Strong> quando houver determinação legal, judicial ou
              regulatória.
            </>,
          ]}
        />
        <P>
          Parte desses parceiros pode tratar dados fora do Brasil. Nesses casos, adotamos
          salvaguardas compatíveis com a LGPD para a transferência internacional.
        </P>
      </LegalSection>

      <LegalSection n="6" title="Retenção de dados">
        <P>
          Mantemos os dados pelo tempo necessário às finalidades descritas e enquanto sua
          conta estiver ativa. Após o encerramento da conta, os dados são eliminados ou
          anonimizados em prazo razoável, salvo quando a retenção for exigida por lei
          (por exemplo, registros de acesso) ou necessária para exercício de direitos em
          processo. Leads e conversas podem ser excluídos por você a qualquer momento
          dentro da plataforma.
        </P>
      </LegalSection>

      <LegalSection n="7" title="Direitos do titular">
        <P>Nos termos da LGPD, você pode, a qualquer momento:</P>
        <List
          items={[
            "Confirmar a existência de tratamento e acessar seus dados.",
            "Corrigir dados incompletos, inexatos ou desatualizados.",
            "Solicitar anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade.",
            "Solicitar a portabilidade dos dados a outro fornecedor.",
            "Revogar o consentimento e se opor a tratamentos, quando aplicável.",
            "Obter informação sobre com quem compartilhamos seus dados.",
          ]}
        />
        <P>
          Para exercer seus direitos, entre em contato com nosso Encarregado pelos canais
          abaixo. Contatos importados podem exercer seus direitos diretamente com o
          usuário que os cadastrou (controlador) — encaminharemos as solicitações que
          recebermos.
        </P>
      </LegalSection>

      <LegalSection n="8" title="Opt-out e descadastro">
        <P>
          Todo destinatário pode pedir para não receber mais mensagens. Pedidos de
          opt-out devem ser respeitados de imediato pelo usuário responsável pela
          campanha, e a plataforma oferece recursos para registrar e honrar esses
          pedidos. Comunicações de marketing nossas também trazem opção de descadastro.
        </P>
      </LegalSection>

      <LegalSection n="9" title="Segurança">
        <P>
          Adotamos medidas técnicas e organizacionais para proteger os dados contra
          acesso não autorizado, perda ou alteração, incluindo controle de acesso,
          criptografia em trânsito e segregação de dados por conta (multitenant). Nenhum
          sistema é totalmente imune a riscos, mas trabalhamos continuamente para mitigá-los.
        </P>
      </LegalSection>

      <LegalSection n="10" title="Encarregado (DPO) e contato">
        <P>
          Para dúvidas sobre privacidade ou para exercer seus direitos, fale com nosso
          Encarregado pelo Tratamento de Dados Pessoais:
        </P>
        <ContactCard
          label="Encarregado de Dados (DPO)"
          email="dpo@disparador.ai"
          note="Responderemos às solicitações nos prazos previstos pela LGPD."
        />
      </LegalSection>

      <LegalSection n="11" title="Atualizações desta Política">
        <P>
          Podemos atualizar esta Política para refletir mudanças no serviço ou na
          legislação. Alterações relevantes serão comunicadas pela plataforma ou por
          e-mail. A data da última atualização consta no topo desta página.
        </P>
      </LegalSection>
    </article>
  );
}
