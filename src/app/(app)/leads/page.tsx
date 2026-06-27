import { getTenantUserId } from "@/lib/tenant";
import { getOnboardingState } from "@/server/services/onboarding.service";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { LeadsDashboard } from "@/components/LeadsDashboard";

export default async function LeadsPage() {
  // Onboarding in-app: enquanto a conta não concluir os passos aplicáveis ao
  // seu plano (número + leads sempre; campanha/IA/agenda conforme PLAN_LIMITS),
  // mostramos o checklist de primeiros passos no topo da página de leads.
  const userId = await getTenantUserId();
  const onboarding = userId ? await getOnboardingState(userId) : null;

  return (
    <div className="space-y-5">
      {onboarding && !onboarding.done && (
        <OnboardingChecklist state={onboarding} />
      )}
      <LeadsDashboard />
    </div>
  );
}
