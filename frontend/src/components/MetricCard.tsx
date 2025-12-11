interface MetricCardProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
}

export const MetricCard = ({ label, value, icon }: MetricCardProps) => {
  return (
    <div className="bg-metric-card rounded-lg border border-border p-6 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-3xl font-semibold text-foreground tracking-tight">{value}</p>
        </div>
        {icon && (
          <div className="text-primary opacity-80">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
};
