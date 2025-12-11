import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

export const CampaignForm = () => {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    discount: "",
    budget: "",
    startDate: "",
    endDate: "",
    audience: "",
    product_id: "",
    walletAddress: "",
  });
  
  const requiresWalletAddress = formData.audience !== "" && formData.audience !== "all";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    if (new Date(formData.endDate) <= new Date(formData.startDate)) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "End date must be after start date",
      });
      return;
    }

    // Wallet address validation for specific audience types
    if (requiresWalletAddress && !formData.walletAddress) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Wallet address is required for the selected audience type",
      });
      return;
    }

    try {
      // Here you would typically send the data to your API
      const submissionData = {
        ...formData,
        // Only include walletAddress if it's required
        ...(requiresWalletAddress && { walletAddress: formData.walletAddress })
      };
      console.log("Submitting form data:", submissionData);
      
      // Simulate API call
      // const response = await fetch('/api/campaigns', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     ...formData,
      //     discount: Number(formData.discount),
      //     budget: Number(formData.budget),
      //   }),
      // });
      // const data = await response.json();

      // Show success message
      toast({
        title: "Campaign Created",
        description: `"${formData.name}" has been created successfully.`,
      });

      // Reset form
      setFormData({
        name: "",
        description: "",
        discount: "",
        budget: "",
        startDate: "",
        endDate: "",
        audience: "",
        product_id: "",
        walletAddress: "",
      });
    } catch (error) {
      console.error("Error creating campaign:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create campaign. Please try again.",
      });
    }
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-foreground">Create New Campaign</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set up a new marketing campaign with custom targeting and budget
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium text-foreground">
            Campaign Name
          </Label>
          <Input
            id="name"
            placeholder="e.g., Summer Sale 2024"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="h-11"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description" className="text-sm font-medium text-foreground">
            Description
          </Label>
          <Textarea
            id="description"
            placeholder="Describe your campaign objectives and target outcomes"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="min-h-[100px] resize-none"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="discount" className="text-sm font-medium text-foreground">
              Discount (%)
            </Label>
            <Input
              id="discount"
              type="number"
              placeholder="15"
              value={formData.discount}
              onChange={(e) => setFormData({ ...formData, discount: e.target.value })}
              className="h-11"
              min="0"
              max="100"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget" className="text-sm font-medium text-foreground">
              Budget ($)
            </Label>
            <Input
              id="budget"
              type="number"
              placeholder="10000"
              value={formData.budget}
              onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
              className="h-11"
              min="0"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="startDate" className="text-sm font-medium text-foreground">
              Start Date
            </Label>
            <Input
              id="startDate"
              type="date"
              value={formData.startDate}
              onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
              className="h-11"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="endDate" className="text-sm font-medium text-foreground">
              End Date
            </Label>
            <Input
              id="endDate"
              type="date"
              value={formData.endDate}
              onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
              className="h-11"
              required
            />
          </div>
          <div className="space-y-2">
          <Label htmlFor="product_id" className="text-sm font-medium text-foreground">
            Product ID
          </Label>
          <Input
            id="product_id"
            placeholder="e.g., 12346464"
            value={formData.product_id}
            onChange={(e) => setFormData({ ...formData, product_id: e.target.value })}
            className="h-11"
            required
          />
        </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="audience" className="text-sm font-medium text-foreground">
            Target Audience
          </Label>
          <Select
            value={formData.audience}
            onValueChange={(value) => setFormData({ ...formData, audience: value, walletAddress: "" })}
            required
          >
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Select target audience" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="premium">Premium Members</SelectItem>
              <SelectItem value="first-time">First-time Buyers</SelectItem>
              <SelectItem value="vip">VIP Members</SelectItem>
              <SelectItem value="students">Students</SelectItem>
              <SelectItem value="inactive">Inactive Users</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {requiresWalletAddress && (
          <div className="space-y-2">
            <Label htmlFor="walletAddress" className="text-sm font-medium text-foreground">
              Wallet Address
            </Label>
            <Input
              id="walletAddress"
              placeholder="Enter wallet address"
              value={formData.walletAddress}
              onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value })}
              className="h-11"
              required={requiresWalletAddress}
            />
          </div>
        )}

        <div className="pt-2">
          <Button 
            type="submit" 
            className="w-full h-11 text-base font-medium"
            disabled={!formData.name || 
                     !formData.description || 
                     !formData.discount || 
                     !formData.budget || 
                     !formData.startDate || 
                     !formData.endDate || 
                     !formData.audience || 
                     !formData.product_id ||
                     (requiresWalletAddress && !formData.walletAddress)}
          >
            Create Campaign
          </Button>
        </div>
      </form>
    </div>
  );
};
