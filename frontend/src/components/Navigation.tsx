import { NavLink } from "@/components/NavLink";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export const Navigation = () => {
  return (
    <nav className="border-b border-border bg-card">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">PT</span>
              </div>
              <span className="text-lg font-semibold text-foreground">Promo Targeting</span>
            </div>
            
            <div className="hidden md:flex items-center gap-1">
              <NavLink
                to="/"
                end
                className="px-3 py-2 text-sm font-medium text-muted-foreground rounded-md hover:text-foreground hover:bg-accent transition-colors"
                activeClassName="text-foreground bg-accent"
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/ecommerce"
                className="px-3 py-2 text-sm font-medium text-muted-foreground rounded-md hover:text-foreground hover:bg-accent transition-colors"
                activeClassName="text-foreground bg-accent"
              >
                E-commerce
              </NavLink>
              <NavLink
                to="/marketplace"
                className="px-3 py-2 text-sm font-medium text-muted-foreground rounded-md hover:text-foreground hover:bg-accent transition-colors"
                activeClassName="text-foreground bg-accent"
              >
                Marketplace
              </NavLink>
            </div>
          </div>

          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
              DR
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </nav>
  );
};
