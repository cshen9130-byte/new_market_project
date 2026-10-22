import { Redirect } from "expo-router"
import { useAuth } from "@/auth"

export default function Index() {
  const { user } = useAuth()
  return <Redirect href={user ? "/(tabs)/home" : "/login"} />
}
