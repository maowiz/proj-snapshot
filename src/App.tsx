import React, { useState } from 'react'
import InitializationScreen from './screens/InitializationScreen'

export default function App() {
    const [showMain, setShowMain] = useState(false)

    return (
        <div style={{ height: '100vh', width: '100vw', backgroundColor: '#0a0015', margin: 0, padding: 0 }}>
            {!showMain ? (
                <InitializationScreen
                    onDone={() => setShowMain(true)}
                    enable3D={true}
                />
            ) : (
                <div style={{ padding: 40 }}>Main App (Initialization complete)</div>
            )}
        </div>
    )
}
