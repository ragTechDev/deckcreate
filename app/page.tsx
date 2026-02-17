import { Container } from '@mantine/core';
import { Header } from './components/Header';
import { CarouselForm } from './components/CarouselForm';

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', paddingBottom: '2rem' }}>
      <Header />
      <Container size="md" px="md">
        <CarouselForm />
      </Container>
    </div>
  );
}
