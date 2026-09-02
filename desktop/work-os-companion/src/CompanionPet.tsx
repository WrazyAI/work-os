type CompanionPetPose = "sleep" | "alert" | "focus" | "rest" | "eod";

export function CompanionPet({ pose = "sleep", className = "" }: { pose?: CompanionPetPose; className?: string }) {
  const eyes = pose === "sleep" ? <><path d="M28 40q5 4 10 0" /><path d="M58 40q5 4 10 0" /></>
    : pose === "alert" ? <><circle cx="33" cy="39" r="3.5" /><circle cx="63" cy="39" r="3.5" /></>
      : <><path d="M29 39h8" /><path d="M59 39h8" /></>;
  return <svg className={`companion-pet pose-${pose} ${className}`} viewBox="0 0 96 96" role="img" aria-label={`Work OS companion, ${pose}`}>
    <path className="pet-shadow" d="M15 84c8-8 58-8 66 0-11 7-54 7-66 0Z" />
    <path className="pet-tail" d="M75 62c13-3 14-15 6-18-5-2-8 2-5 6" />
    <path className="pet-ear" d="m25 32-6-13 16 6M71 32l6-13-16 6" />
    <path className="pet-body" d="M18 47c0-17 13-29 30-29s30 12 30 29v22c0 11-12 17-30 17S18 80 18 69V47Z" />
    <path className="pet-arm" d="M20 57 9 64m67-7 11 7" />
    <path className="pet-screen" d="M25 38c0-10 10-17 23-17s23 7 23 17v18c0 11-10 18-23 18S25 67 25 56V38Z" />
    <path className="pet-panel" d="M34 70h28v8H34z" />
    <g className="pet-face">{eyes}<path d="M42 53q6 5 12 0" /><path d="M30 59h5M61 59h5" /></g>
    <path className="pet-badge" d="M40 76h16M48 21V10m-6 0h12" />
    {pose === "alert" && <path className="pet-spark" d="m48 8 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />}
    {pose === "focus" && <path className="pet-focus" d="M76 24h8M80 20v8" />}
  </svg>;
}
