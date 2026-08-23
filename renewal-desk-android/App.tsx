import { StatusBar } from 'expo-status-bar';
import { ServiceReadinessScreen } from './src/screens/ServiceReadinessScreen';

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <ServiceReadinessScreen />
    </>
  );
}
