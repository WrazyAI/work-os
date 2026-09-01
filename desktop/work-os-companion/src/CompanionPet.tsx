type CompanionPetPose = "sleep" | "alert" | "focus" | "rest" | "eod";

export function CompanionPet({ pose = "sleep", className = "" }: { pose?: CompanionPetPose; className?: string }) {
  const eyes = pose === "sleep" ? <><path d="M28 40q5 4 10 0" /><path d="M58 40q5 4 10 0" /></>
    : pose === "alert" ? <><circle cx="33" cy="39" r="3.5" /><circle cx="63" cy="39" r="3.5" /></>
      : <><path d="M29 39h8" /><path d="M59 39h8" /></>;
  return <svg className={`companion-pet pose-${pose} ${className}`} viewBox="0 0 96 96" role="img" aria-label={`Work OS companion, ${pose}`}>
    <path className="pet-shadow" d="M20 78c8-7 48-7 56 0-9 7-47 7-56 0Z" />
    <path className="pet-tail" d="M70 66c11 2 15-7 10-13-3-3-7-1-6 4" />
    <path className="pet-body" d="M20 47c0-16 12-27 28-27s28 11 28 27v19c0 11-12 18-28 18S20 77 20 66V47Z" />
    <path className="pet-badge" d="M48 20V12m-5 0h10" />
    <path className="pet-screen" d="M26 38c0-9 9-15 22-15s22 6 22 15v17c0 10-9 16-22 16s-22-6-22-16V38Z" />
    <g className="pet-face">{eyes}<path d="M42 52q6 5 12 0" /><path d="M31 56h4M61 56h4" /></g>
    <path className="pet-badge" d="M42 75h12" />
    {pose === "alert" && <path className="pet-spark" d="m48 8 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />}
    {pose === "focus" && <path className="pet-focus" d="M76 24h8M80 20v8" />}
  </svg>;
}
