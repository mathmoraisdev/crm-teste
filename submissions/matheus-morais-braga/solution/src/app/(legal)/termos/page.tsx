import type { Metadata } from "next";
import { LegalHeader, LegalSection, List, P, Strong } from "../_components";

export const metadata: Metadata = {
  title: "Termos de Uso — Disparador.ai",
  description:
    "Condições de uso da plataforma Disparador.ai: conta, uso aceitável, responsabilidades, pagamento e limitações.",
};

export default function TermosPage() {
  return (
    <article>
      <LegalHeader
        eyebrow="Termos"
        title="Termos de Uso"
        intro="Estes Termos regem o acesso e o uso da plataforma Disparador.ai. Ao criar uma conta ou usar o serviço, você concorda integralmente com as condições abaixo."
      />

      <LegalSection n="1" title="O serviço">
        <P>
          O <Strong>Disparador.ai</Strong> é uma plataforma que permite enviar mensagens
          em massa pelo WhatsApp, organizar contatos em um CRM e usar recursos de
          inteligência artificial para classificar leads e sugerir respostas. O serviço é
          fornecido &ldquo;como está&rdquo; e pode evoluir, com inclusão ou remoção de
          funcionalidades ao longo do tempo.
        </P>
      </LegalSection>

      <LegalSection n="2" title="Conta e cadastro">
        <List
          items={[
            "Você deve fornecer informações verdadeiras e mantê-las atualizadas.",
            "Você é responsável por manter a confidencialidade de suas credenciais e por toda atividade realizada na sua conta.",
            "A conta é pessoal e intransferível; o uso por terceiros depende de autorização sua e da observância destes Termos.",
            "É necessário ser maior de 18 anos ou estar devidamente representado para usar o serviço.",
          ]}
        />
      </LegalSection>

      <LegalSection n="3" title="Uso aceitável">
        <P>
          Você se compromete a usar a plataforma de forma lícita e ética. É{" "}
          <Strong>expressamente proibido</Strong>:
        </P>
        <List
          items={[
            <>
              Enviar <Strong>spam</Strong> ou mensagens não solicitadas em massa.
            </>,
            <>
              Usar <Strong>listas de contatos sem consentimento</Strong> dos
              destinatários ou obtidas de forma irregular.
            </>,
            "Enviar conteúdo ilegal, enganoso, fraudulento, difamatório, discriminatório ou que viole direitos de terceiros.",
            "Praticar phishing, golpes, disseminar malware ou tentar burlar mecanismos de segurança e anti-bloqueio.",
            "Sobrecarregar, prejudicar ou interferir na operação da plataforma ou de terceiros.",
            "Violar os termos do WhatsApp/Meta, da LGPD, do Código de Defesa do Consumidor ou de qualquer legislação aplicável.",
          ]}
        />
        <P>
          O descumprimento pode levar à suspensão imediata da conta, sem prejuízo de
          outras medidas cabíveis.
        </P>
      </LegalSection>

      <LegalSection n="4" title="Responsabilidade pela base e pelo conteúdo">
        <P>
          Você é o <Strong>único responsável</Strong> pelos contatos que importa e pelo
          conteúdo das mensagens que envia. Isso inclui:
        </P>
        <List
          items={[
            "Garantir que possui consentimento ou outra base legal para contatar cada destinatário.",
            "Respeitar pedidos de opt-out e descadastro de forma imediata.",
            "Assegurar que o conteúdo enviado é verdadeiro, legal e adequado ao público.",
            "Cumprir a LGPD na condição de controlador dos dados dos seus contatos.",
          ]}
        />
        <P>
          O Disparador.ai atua como ferramenta e operador desses dados, não revisando
          previamente o conteúdo das suas campanhas.
        </P>
      </LegalSection>

      <LegalSection n="5" title="Propriedade intelectual">
        <P>
          A plataforma, sua marca, design, código e demais elementos são de titularidade
          do Disparador.ai e protegidos por lei. Estes Termos concedem a você uma licença
          limitada, não exclusiva e revogável de uso, durante a vigência da contratação.
          O conteúdo e os dados que você insere permanecem seus; você nos concede apenas a
          licença necessária para operar o serviço em seu benefício.
        </P>
      </LegalSection>

      <LegalSection n="6" title="Planos e pagamento">
        <P>
          O serviço é oferecido em planos com diferentes limites e recursos. Atualmente, a
          contratação e o pagamento dos planos são tratados de forma{" "}
          <Strong>manual</Strong>, mediante combinação direta com nossa equipe. Os limites
          de uso e o período contratado são informados no momento da contratação.
        </P>
        <List
          items={[
            "Valores e limites podem ser ajustados, com aviso prévio razoável.",
            "O não pagamento pode resultar em suspensão ou encerramento do acesso.",
            "Salvo disposição legal em contrário, valores já pagos por período em uso não são reembolsáveis.",
          ]}
        />
      </LegalSection>

      <LegalSection n="7" title="Limitação de responsabilidade">
        <P>
          O Disparador.ai não garante disponibilidade ininterrupta nem resultados
          comerciais específicos. Na máxima extensão permitida em lei, não nos
          responsabilizamos por:
        </P>
        <List
          items={[
            "Bloqueios, banimentos ou limitações impostas pelo WhatsApp/Meta ao seu número.",
            "Uso indevido da plataforma por você ou por terceiros sob sua conta.",
            "Danos indiretos, lucros cessantes ou perda de oportunidades decorrentes do uso do serviço.",
            "Conteúdo gerado por inteligência artificial, que deve ser revisado antes do envio.",
          ]}
        />
        <P>
          Os recursos anti-bloqueio reduzem riscos, mas não os eliminam; a forma como você
          usa a plataforma influencia diretamente a saúde do seu número.
        </P>
      </LegalSection>

      <LegalSection n="8" title="Rescisão">
        <P>
          Você pode encerrar sua conta a qualquer momento. Podemos suspender ou encerrar o
          acesso em caso de violação destes Termos, exigência legal ou descontinuação do
          serviço, buscando, sempre que possível, aviso prévio. Encerrada a conta,
          aplicam-se as regras de retenção e eliminação descritas na{" "}
          <a href="/privacidade" className="font-semibold text-brand-600 hover:text-brand-500">
            Política de Privacidade
          </a>
          .
        </P>
      </LegalSection>

      <LegalSection n="9" title="Alterações destes Termos">
        <P>
          Podemos atualizar estes Termos a qualquer momento. Mudanças relevantes serão
          comunicadas pela plataforma ou por e-mail. O uso continuado após a vigência das
          alterações implica concordância com a nova versão.
        </P>
      </LegalSection>

      <LegalSection n="10" title="Lei aplicável e foro">
        <P>
          Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica
          eleito o foro do domicílio do usuário, quando consumidor, para dirimir
          controvérsias decorrentes destes Termos, sem prejuízo das normas de proteção
          aplicáveis.
        </P>
      </LegalSection>
    </article>
  );
}
